#!/usr/bin/env python3
"""Exercise KYC ownership, private uploads, reviews and withdrawal gating over HTTP.

Uses a disposable database and upload directory with synthetic identity details
and generated image bytes. No real identity documents or external services.
"""
import base64
import datetime as dt
import http.cookiejar
import json
import os
from pathlib import Path
import socket
import sqlite3
import struct
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import zlib

ROOT = Path(__file__).resolve().parent.parent
checks = 0


def check(condition, message):
    global checks
    if not condition:
        raise AssertionError(message)
    checks += 1


def png():
    def chunk(kind, value):
        return struct.pack('!I', len(value)) + kind + value + struct.pack('!I', zlib.crc32(kind + value) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!IIBBBBB', 2, 2, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(b'\x00' + b'\x11\x22\x33' * 2 + b'\x00' + b'\x44\x55\x66' * 2)) + chunk(b'IEND', b'')


IMAGE = png()
PROFILE = {
    'legal_name': 'Synthetic KYC Person', 'date_of_birth': '1992-03-04', 'country': 'US',
    'address': '123 Synthetic Verification Street, Test City', 'document_type': 'passport',
    'document_number': 'SYNTHETIC-KYC-0001', 'consent': '1',
}
FILES = {'id_document': ('synthetic-id.png', 'image/png', IMAGE), 'selfie': ('synthetic-selfie.png', 'image/png', IMAGE)}
WITHDRAWAL = {'type': 'withdrawal', 'amount_cents': 10000, 'method': 'bank', 'details': {'bank_name': 'Test Bank', 'account_name': 'Synthetic Member', 'account_number': '1234567890'}, 'idempotency_key': 'kyc-withdrawal-check-001'}


def multipart(fields, files):
    boundary = 'EDGEKycBoundary' + os.urandom(10).hex()
    parts = []
    for name, value in fields.items():
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    for name, (filename, mime, data) in files.items():
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{filename}"\r\nContent-Type: {mime}\r\n\r\n'.encode() + data + b'\r\n')
    parts.append(f'--{boundary}--\r\n'.encode())
    return b''.join(parts), 'multipart/form-data; boundary=' + boundary


class Client:
    def __init__(self, base):
        self.base = base
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.token = None

    def request(self, path, method='GET', data=None, fields=None, files=None, csrf=True):
        headers = {'Accept': 'application/json'}
        raw = None
        if fields is not None:
            raw, headers['Content-Type'] = multipart(fields, files or {})
        elif data is not None:
            headers['Content-Type'] = 'application/json'
            raw = json.dumps(data).encode()
        if csrf and self.token:
            headers['X-CSRF-TOKEN'] = self.token
        request = urllib.request.Request(self.base + path, data=raw, headers=headers, method=method)
        try:
            response = self.opener.open(request, timeout=20)
        except urllib.error.HTTPError as error:
            response = error
        raw = response.read()
        try:
            body = json.loads(raw)
        except (ValueError, UnicodeError):
            body = {'raw': raw[:300].decode(errors='replace')}
        if isinstance(body, dict) and 'csrf_token' in body:
            self.token = body['csrf_token']
        if path.startswith('/api/kyc') or path.startswith('/api/admin/kyc'):
            check('no-store' in response.headers.get('Cache-Control', ''), f'{method} {path} {response.status} cannot cache identity responses, including errors')
        return response.status, body, response.headers, raw

    def expect(self, status, path, method='GET', data=None, **kwargs):
        actual, body, headers, raw = self.request(path, method, data, **kwargs)
        allowed = status if isinstance(status, tuple) else (status,)
        check(actual in allowed, f'{method} {path}: expected {allowed}, received {actual}: {body}')
        return body

    def upload(self, status, fields=None, files=None, **kwargs):
        return self.expect(status, '/api/kyc', 'POST', fields=PROFILE if fields is None else fields, files=FILES if files is None else files, **kwargs)


def main():
    with tempfile.TemporaryDirectory(prefix='edge-kyc-api-') as directory:
        task = Path(directory)
        database = task / 'checks.sqlite'
        database.touch()
        uploads = task / 'private-kyc'
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            port = listener.getsockname()[1]
        base = f'http://127.0.0.1:{port}'
        env = os.environ | {
            'APP_ENV': 'local', 'APP_DEBUG': 'false', 'APP_URL': base,
            'APP_KEY': 'base64:' + base64.b64encode(os.urandom(32)).decode(),
            'DB_CONNECTION': 'sqlite', 'DB_DATABASE': str(database), 'SESSION_DRIVER': 'database',
            'CACHE_STORE': 'database', 'CACHE_PREFIX': 'edge-kyc-api-', 'BCRYPT_ROUNDS': '4',
            'LOG_CHANNEL': 'stderr', 'KYC_STORAGE_PATH': str(uploads), 'EDGE_KYC_TEST_ROOT': str(ROOT),
        }
        subprocess.run(['php', 'artisan', 'migrate', '--force', '--quiet'], cwd=ROOT, env=env, check=True)
        password = 'SyntheticKycCheckPassword123'
        subprocess.run(['php', 'artisan', 'edge:admin', 'admin@kyc.test.invalid', '--name=KYC Test Administrator', '--password=' + password], cwd=ROOT, env=env, check=True, stdout=subprocess.DEVNULL)
        router = task / 'router.php'
        router.write_text("""<?php
define('LARAVEL_START', microtime(true));
require getenv('EDGE_KYC_TEST_ROOT').'/vendor/autoload.php';
$app = require getenv('EDGE_KYC_TEST_ROOT').'/bootstrap/app.php';
$app->make(Illuminate\\Contracts\\Http\\Kernel::class)->bootstrap();
Illuminate\\Support\\Facades\\Http::preventStrayRequests();
$app->handleRequest(Illuminate\\Http\\Request::capture());
""")
        log = open(task / 'server.log', 'w+')
        server = subprocess.Popen(['php', '-d', 'upload_max_filesize=8M', '-d', 'post_max_size=20M', '-S', '127.0.0.1:' + str(port), '-t', str(ROOT / 'public'), str(router)], cwd=ROOT, env=env, stdout=log, stderr=log)

        def sql(query, params=()):
            with sqlite3.connect(database) as connection:
                result = connection.execute(query, params)
                return result.fetchall()

        def reset_limits():
            sql('DELETE FROM cache')

        def money_state(user_id):
            return (sql('SELECT wallet_balance FROM users WHERE id=?', (user_id,))[0][0], sql('SELECT count(*) FROM wallet_requests WHERE user_id=?', (user_id,))[0][0], sql('SELECT count(*) FROM wallet_transactions WHERE user_id=?', (user_id,))[0][0])

        def blocked_withdrawal(client, user_id, suffix):
            reset_limits()
            before = money_state(user_id)
            result = client.expect(422, '/api/wallet/requests', 'POST', WITHDRAWAL | {'idempotency_key': 'kyc-blocked-' + suffix})
            check('kyc' in json.dumps(result).lower() or 'verification' in json.dumps(result).lower(), 'blocked withdrawal explains identity verification requirement')
            check(money_state(user_id) == before, 'blocked withdrawal creates no request, reservation or ledger entry')

        try:
            guest = Client(base)
            for _ in range(100):
                try:
                    if guest.request('/api/session')[0] == 200:
                        break
                except (OSError, urllib.error.URLError):
                    time.sleep(0.1)
            else:
                raise RuntimeError('Local KYC HTTP test server did not start')
            guest.expect(401, '/api/kyc')
            guest.upload(401)
            guest.expect(401, '/api/kyc/1/documents/id_document')
            guest.expect(401, '/api/admin/kyc')
            guest.expect(419, '/api/kyc', 'POST', fields=PROFILE, files=FILES, csrf=False)

            member, other, admin = Client(base), Client(base), Client(base)
            for client, email in [(member, 'member@kyc.test.invalid'), (other, 'other@kyc.test.invalid')]:
                client.expect(200, '/api/session')
                client.expect(201, '/api/auth/register', 'POST', {'name': 'Synthetic Member', 'email': email, 'password': password, 'password_confirmation': password})
            admin.expect(200, '/api/session')
            admin.expect(200, '/api/auth/login', 'POST', {'email': 'admin@kyc.test.invalid', 'password': password})
            member_id = sql('SELECT id FROM users WHERE email=?', ('member@kyc.test.invalid',))[0][0]
            other_id = sql('SELECT id FROM users WHERE email=?', ('other@kyc.test.invalid',))[0][0]
            sql('UPDATE users SET wallet_balance=100000 WHERE id IN (?,?)', (member_id, other_id))
            not_submitted = member.expect(200, '/api/kyc')['kyc']
            check(not_submitted['status'] == 'not_submitted' and not_submitted['withdrawal_requires_approval'] is True, 'new account requires administrator KYC approval before withdrawals')
            blocked_withdrawal(member, member_id, 'not-submitted')
            member.expect(403, '/api/admin/kyc')
            member.expect((403, 404), '/api/admin/kyc/1')
            member.expect((403, 404), '/api/admin/kyc/1/review', 'POST', {'version': 1, 'decision': 'approved'})
            member.upload(419, csrf=False)

            invalid_profiles = [
                PROFILE | {'date_of_birth': '2015-01-01'}, PROFILE | {'date_of_birth': '2099-01-01'},
                PROFILE | {'date_of_birth': 'invalid'}, PROFILE | {'date_of_birth': '2000-02-30'},
                PROFILE | {'legal_name': ''}, PROFILE | {'country': 'INVALID'}, PROFILE | {'document_type': 'script'},
                PROFILE | {'document_number': ''}, PROFILE | {'consent': '0'},
                PROFILE | {'status': 'approved'}, PROFILE | {'user_id': str(other_id)},
                PROFILE | {'version': '999'}, PROFILE | {'reviewed_by': '1'},
            ]
            for invalid in invalid_profiles:
                reset_limits()
                member.upload(422, fields=invalid)
            for files in [
                {'id_document': FILES['id_document']}, {'selfie': FILES['selfie']},
                FILES | {'id_document': ('script.png', 'image/png', b'<?php echo "bad"; ?>')},
                FILES | {'selfie': ('script.jpg', 'image/jpeg', b'<html>not an image</html>')},
                FILES | {'selfie': ('selfie.svg', 'image/svg+xml', b'<svg xmlns="http://www.w3.org/2000/svg"><script>bad()</script></svg>')},
                FILES | {'id_document': ('oversize.png', 'image/png', IMAGE + b'0' * (2 * 1024 * 1024))},
            ]:
                reset_limits()
                member.upload(422, files=files)
            check(sql('SELECT count(*) FROM kyc_submissions')[0][0] == 0, 'invalid identity submissions persist no identity records')
            check(not uploads.exists() or not list(uploads.rglob('*.enc')), 'rejected validation leaves no private identity files')

            reset_limits()
            submitted = member.upload(201)['kyc']
            submission_id = submitted['submission_id']
            version = submitted['version']
            check(submitted['status'] == 'pending' and submitted['submitted_at'], 'valid multipart identity upload is pending until an administrator reviews')
            member.expect(403, f'/api/admin/kyc/{submission_id}')
            member.expect(403, f'/api/admin/kyc/{submission_id}/review', 'POST', {'version': version, 'decision': 'approved'})
            for value in PROFILE.values():
                if len(value) > 12:
                    check(value not in json.dumps(submitted), 'customer status does not unnecessarily expose submitted identity details')
            reset_limits()
            member.upload((409, 422))
            check(sql('SELECT count(*) FROM kyc_submissions')[0][0] == 1, 'duplicate pending upload creates no second submission')
            blocked_withdrawal(member, member_id, 'pending')
            check(other.expect(200, '/api/kyc')['kyc']['status'] == 'not_submitted', 'another account cannot see the pending customer identity')
            for kind in ('id_document', 'selfie'):
                path = f'/api/kyc/{submission_id}/documents/{kind}'
                other.expect(404, path)
                for client in (member, admin):
                    status, body, headers, raw = client.request(path)
                    check(status == 200 and raw == IMAGE, 'only owner or administrator receives the original document bytes')
                    check(headers.get('X-Content-Type-Options') == 'nosniff', 'identity download disables content sniffing')
                    check(headers.get('Content-Disposition', '').startswith('attachment;'), 'identity documents download as attachments')
                    check(headers.get('Content-Type', '').startswith('image/png'), 'identity download supplies validated MIME type')
            member.expect(404, f'/api/kyc/{submission_id}/documents/unknown')
            other.expect(404, f'/api/kyc/{submission_id}/documents/../id_document')
            private_files = list(uploads.rglob('*.enc'))
            check(len(private_files) == 2, 'two submitted documents exist only in the dedicated private disk')
            for stored in private_files:
                contents = stored.read_bytes()
                check(contents != IMAGE and IMAGE not in contents and not contents.startswith(b'\x89PNG'), 'identity images are encrypted at rest')
                check(stored.stat().st_mode & 0o077 == 0, 'identity file permissions exclude other local users')
                relative = stored.relative_to(uploads).as_posix()
                guest.expect((403, 404), '/storage/' + relative)
            with sqlite3.connect(database) as connection:
                connection.row_factory = sqlite3.Row
                raw_row = dict(connection.execute('SELECT * FROM kyc_submissions WHERE id=?', (submission_id,)).fetchone())
            serialized_row = json.dumps(raw_row)
            for name in ('legal_name', 'date_of_birth', 'address', 'document_number'):
                check(PROFILE[name] not in serialized_row, f'{name} is encrypted in the identity database record')
            check('.enc' not in str(raw_row.get('documents')), 'stored document paths and metadata are encrypted')

            queue = admin.expect(200, '/api/admin/kyc?status=pending')
            check([row['id'] for row in queue['submissions']] == [submission_id], 'administrator pending queue contains submitted identity')
            for name in ('legal_name', 'date_of_birth', 'address', 'document_number'):
                check(PROFILE[name] not in json.dumps(queue), 'administrator review queue omits full identity details')
            detail = admin.expect(200, f'/api/admin/kyc/{submission_id}')['submission']
            check(detail['legal_name'] == PROFILE['legal_name'] and detail['document_number'] == PROFILE['document_number'], 'authorized detail view decrypts the submitted identity for review')
            check(detail['documents']['id_document']['download_url'].endswith(f'/api/kyc/{submission_id}/documents/id_document'), 'review uses authenticated document downloads')
            admin.expect(422, f'/api/admin/kyc/{submission_id}/review', 'POST', {'version': version, 'decision': 'rejected'})
            admin.expect(422, f'/api/admin/kyc/{submission_id}/review', 'POST', {'version': version, 'decision': 'rejected', 'review_note': 'bad'})
            admin.expect(409, f'/api/admin/kyc/{submission_id}/review', 'POST', {'version': version + 1, 'decision': 'approved'})
            admin.expect(422, f'/api/admin/kyc/{submission_id}/review', 'POST', {'version': version, 'decision': 'approved', 'user_id': other_id})
            reject_note = 'Synthetic document needs a clearer replacement image.'
            rejection = {'version': version, 'decision': 'rejected', 'review_note': reject_note}
            admin.expect(200, f'/api/admin/kyc/{submission_id}/review', 'POST', rejection)
            admin.expect(200, f'/api/admin/kyc/{submission_id}/review', 'POST', rejection)
            rejected = member.expect(200, '/api/kyc')['kyc']
            check(rejected['status'] == 'rejected' and rejected['review_note'] == reject_note, 'rejected customer receives the administrator reason and can correct the submission')
            check(reject_note not in sql('SELECT review_note FROM kyc_submissions WHERE id=?', (submission_id,))[0][0], 'private administrator review notes are encrypted in the identity record')
            check(reject_note not in json.dumps(member.expect(200, '/api/session')), 'general session does not copy private review notes')
            check(reject_note not in json.dumps(member.expect(200, '/api/state')), 'financial state does not copy private review notes')
            check(reject_note not in json.dumps(admin.expect(200, '/api/admin/users')), 'general administrator user directory does not copy private review notes')
            blocked_withdrawal(member, member_id, 'rejected')
            admin.expect(409, f'/api/admin/kyc/{submission_id}/review', 'POST', {'version': rejected['version'], 'decision': 'approved'})

            reset_limits()
            resubmitted = member.upload(201, fields=PROFILE | {'document_number': 'SYNTHETIC-KYC-0002'})['kyc']
            replacement_id = resubmitted['submission_id']
            check(replacement_id != submission_id and resubmitted['status'] == 'pending', 'rejection allows a new independently reviewed submission')
            approval = {'version': resubmitted['version'], 'decision': 'approved'}
            admin.expect(200, f'/api/admin/kyc/{replacement_id}/review', 'POST', approval)
            admin.expect(200, f'/api/admin/kyc/{replacement_id}/review', 'POST', approval)
            approved = member.expect(200, '/api/kyc')['kyc']
            check(approved['status'] == 'approved' and approved['reviewed_at'], 'administrator approval becomes the current customer KYC status')
            check(member.expect(200, '/api/session')['user']['kyc_status'] == 'approved', 'session refresh publishes approved status without identity details')
            check(member.expect(200, '/api/state')['user']['kyc_status'] == 'approved', 'financial state publishes the same approved KYC status')
            admin.expect(409, f'/api/admin/kyc/{replacement_id}/review', 'POST', {'version': approved['version'], 'decision': 'rejected', 'review_note': 'Changed review should be blocked.'})
            reset_limits()
            member.upload((409, 422))
            check(member.expect(200, '/api/kyc')['kyc']['status'] == 'approved', 'approved identity cannot be replaced or revoked by customer resubmission')
            before = money_state(member_id)
            withdrawal = member.expect(201, '/api/wallet/requests', 'POST', WITHDRAWAL)['request']
            check(money_state(member_id) == (before[0] - 10000, before[1] + 1, before[2] + 1), 'approved KYC allows withdrawal and reserves its funds once')
            member.expect(201, '/api/wallet/requests', 'POST', WITHDRAWAL)
            check(money_state(member_id)[0] == before[0] - 10000, 'approved withdrawal retry cannot reserve funds twice')
            admin.expect(200, f"/api/admin/wallet-requests/{withdrawal['id']}/review", 'POST', {'decision': 'reject', 'reference': 'Synthetic integration refund'})
            check(money_state(member_id)[0] == before[0], 'existing administrator withdrawal review and refund still work')

            # Migration must not strand financial requests which predate the KYC gate.
            sql('UPDATE users SET wallet_balance=90000 WHERE id=?', (other_id,))
            sql("INSERT INTO wallet_requests (user_id,reference,request_hash,type,amount,method,details,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)", (other_id, 'pre-kyc-pending-withdrawal', '0' * 64, 'withdrawal', 10000, 'bank', '{}', 'pending'))
            legacy_id = sql('SELECT id FROM wallet_requests WHERE reference=?', ('pre-kyc-pending-withdrawal',))[0][0]
            admin.expect(200, f'/api/admin/wallet-requests/{legacy_id}/review', 'POST', {'decision': 'reject', 'reference': 'Pre-existing request refund'})
            check(money_state(other_id)[0] == 100000, 'existing pending withdrawal can still be reviewed without retroactive KYC deadlock')

            reset_limits()
            admin_submission = admin.upload(201)['kyc']
            admin.expect(403, f"/api/admin/kyc/{admin_submission['submission_id']}/review", 'POST', {'version': admin_submission['version'], 'decision': 'approved'})
            check(admin.expect(200, '/api/kyc')['kyc']['status'] == 'pending', 'administrator cannot approve their own identity')
            rows = sql("SELECT action,reason,\"before\",\"after\" FROM admin_audits WHERE subject_type='KycSubmission'")
            check(sum(row[0] in ('kyc.approved', 'kyc.rejected') for row in rows) == 2, 'exact repeated KYC decisions create no duplicate audit entry')
            audit_text = json.dumps(rows)
            for value in [PROFILE['legal_name'], PROFILE['address'], PROFILE['document_number'], 'SYNTHETIC-KYC-0002', PROFILE['date_of_birth'], reject_note, '.enc']:
                check(value not in audit_text, 'KYC audit trail records review metadata without identity fields, file paths or free-text reasons')
            overview = admin.expect(200, '/api/admin/overview')
            for value in [PROFILE['legal_name'], PROFILE['document_number'], reject_note]:
                check(value not in json.dumps(overview), 'administrator overview does not leak KYC identity via audit previews')
            log.flush()
            log.seek(0)
            application_log = log.read()
            for value in [PROFILE['legal_name'], PROFILE['document_number'], reject_note]:
                check(value not in application_log, 'application HTTP logs contain no submitted identity or review reason')
            print(f'PASS: {checks} KYC HTTP integration checks.')
        except Exception:
            log.flush()
            log.seek(0)
            print(log.read()[-8000:])
            raise
        finally:
            server.terminate()
            try:
                server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait(timeout=5)
            log.close()


if __name__ == '__main__':
    main()
