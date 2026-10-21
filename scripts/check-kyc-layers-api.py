#!/usr/bin/env python3
"""Real HTTP checks for per-user KYC requirements. Synthetic data, isolated storage."""
import base64
import importlib.util
import json
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import tempfile
import time
import urllib.error

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('kyc_http_helpers', ROOT / 'scripts/check-kyc-api.py')
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)
checks = 0


def check(condition, message):
    global checks
    if not condition:
        raise AssertionError(message)
    checks += 1


h.check = check


def main():
    with tempfile.TemporaryDirectory(prefix='edge-kyc-layers-http-') as directory:
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
            'CACHE_STORE': 'database', 'CACHE_PREFIX': 'edge-kyc-layers-', 'BCRYPT_ROUNDS': '4',
            'LOG_CHANNEL': 'stderr', 'KYC_STORAGE_PATH': str(uploads), 'EDGE_KYC_TEST_ROOT': str(ROOT),
        }
        subprocess.run(['php', 'artisan', 'migrate', '--force', '--quiet'], cwd=ROOT, env=env, check=True)
        password = 'SyntheticLayersPassword123'
        subprocess.run(['php', 'artisan', 'edge:admin', 'admin@layers.test.invalid', '--name=Layers Test Admin', '--password=' + password], cwd=ROOT, env=env, check=True, stdout=subprocess.DEVNULL)
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
        server = subprocess.Popen(['php', '-d', 'upload_max_filesize=2M', '-d', 'post_max_size=8M', '-S', '127.0.0.1:' + str(port), '-t', str(ROOT / 'public'), str(router)], cwd=ROOT, env=env, stdout=log, stderr=log)

        def sql(query, params=()):
            with sqlite3.connect(database) as connection:
                return connection.execute(query, params).fetchall()

        def reset_limits():
            sql('DELETE FROM cache')

        def file_count():
            return len(list(uploads.rglob('*.enc'))) if uploads.exists() else 0

        try:
            guest = h.Client(base)
            for _ in range(100):
                try:
                    if guest.request('/api/session')[0] == 200:
                        break
                except (OSError, urllib.error.URLError):
                    time.sleep(0.1)
            else:
                raise RuntimeError('KYC layers HTTP test server did not start')
            guest.expect(401, '/api/admin/kyc/requirements')
            guest.expect(401, '/api/admin/kyc/users')
            member, other, admin = h.Client(base), h.Client(base), h.Client(base)
            for client, email in [(member, 'member@layers.test.invalid'), (other, 'other@layers.test.invalid')]:
                client.expect(200, '/api/session')
                client.expect(201, '/api/auth/register', 'POST', {'name':'Synthetic Layers Member','email':email,'password':password,'password_confirmation':password})
            admin.expect(200, '/api/session')
            admin.expect(200, '/api/auth/login', 'POST', {'email':'admin@layers.test.invalid','password':password})
            member_id = sql('SELECT id FROM users WHERE email=?', ('member@layers.test.invalid',))[0][0]
            other_id = sql('SELECT id FROM users WHERE email=?', ('other@layers.test.invalid',))[0][0]
            assign_url = f'/api/admin/kyc/users/{member_id}/requirements'
            member.expect(403, '/api/admin/kyc/requirements')
            member.expect(403, '/api/admin/kyc/users')
            member.expect(403, assign_url)
            initial = member.upload(201)['kyc']
            admin.expect(200, f"/api/admin/kyc/{initial['submission_id']}/review", 'POST', {'version':initial['version'],'decision':'approved'})
            check(member.expect(200, '/api/kyc')['kyc']['status'] == 'approved', 'legacy base identity can be approved before additional requirements')
            original_version = admin.expect(200, '/api/admin/kyc/requirements')['settings']['version']
            settings = {'version':original_version,'reason':'We request identity information to verify your account and assess the information relevant to your activity.','layers':[
                {'id':'funds','name':'Source of funds','reason':'Please explain the source of the funds used on this account.','fields':[
                    {'key':'income','label':'Annual income description','type':'text','required':True,'options':[]},
                    {'key':'notes','label':'Additional explanation','type':'textarea','required':False,'options':[]},
                    {'key':'date','label':'Statement date','type':'date','required':True,'options':[]},
                    {'key':'employment','label':'Employment','type':'select','required':True,'options':['Employed','Self employed']},
                    {'key':'attest','label':'I confirm these details are accurate','type':'checkbox','required':True,'options':[]},
                    {'key':'proof','label':'Supporting evidence','type':'file','required':True,'options':[]},
                ]},
                {'id':'residency','name':'Residence details','reason':'Confirm your current place of residence.','fields':[{'key':'region','label':'Region','type':'text','required':True,'options':[]}]},
            ]}
            admin.expect(419, '/api/admin/kyc/requirements', 'PUT', settings, csrf=False)
            bad = json.loads(json.dumps(settings)); bad['layers'][0]['fields'][0]['unexpected'] = 'forbidden'
            admin.expect(422, '/api/admin/kyc/requirements', 'PUT', bad)
            admin.expect(200, '/api/admin/kyc/requirements', 'PUT', settings)
            admin.expect(409, '/api/admin/kyc/requirements', 'PUT', settings)
            current_settings = admin.expect(200, '/api/admin/kyc/requirements')['settings']
            check(len(current_settings['layers']) == 2, 'administrator can persist multiple reusable verification layers')
            assignment = admin.expect(200, assign_url)['requirements']
            admin.expect(422, assign_url, 'PUT', {'version':assignment['version'],'layer_ids':['missing'],'reason':''})
            admin.expect(200, assign_url, 'PUT', {'version':assignment['version'],'layer_ids':['funds','residency'],'reason':'Please complete the additional account review requested for your profile.'})
            assignment = admin.expect(200, assign_url)['requirements']
            admin.expect(409, assign_url, 'PUT', {'version':0,'layer_ids':[],'reason':''})
            check(assignment['version'] > 0 and len(assignment['layers']) == 2, 'individual user assignment has a versioned layer snapshot')
            directory = admin.expect(200, '/api/admin/kyc/users?search=member%40layers.test.invalid')
            check([row['id'] for row in directory['users']] == [member_id], 'admin finds an individual account for requirements assignment')
            summary = member.expect(200, '/api/kyc')['kyc']
            check(summary['status'] == 'additional_required' and summary['requirements_changed'], 'new layers require fresh approval on a previously approved account')
            check(summary['reason'] == settings['reason'] and summary['requirements']['reason'] == assignment['reason'], 'customer receives global and user-specific explanations')
            other_summary = other.expect(200, '/api/kyc')['kyc']
            check(not other_summary['requirements']['layers'] and assignment['reason'] not in json.dumps(other_summary), 'additional layers and private reason are specific to the selected user')
            sql('UPDATE users SET wallet_balance=100000 WHERE id=?', (member_id,))
            financial_before = sql('SELECT wallet_balance FROM users WHERE id=?', (member_id,))[0][0]
            member.expect(422, '/api/wallet/requests', 'POST', h.WITHDRAWAL | {'idempotency_key':'kyc-layers-blocked-withdrawal'})
            check(sql('SELECT wallet_balance FROM users WHERE id=?', (member_id,))[0][0] == financial_before and sql('SELECT COUNT(*) FROM wallet_requests')[0][0] == 0, 'additional requirements block withdrawals without reserving funds')
            count_before = file_count()
            reset_limits(); member.upload(409, fields=h.PROFILE | {'requirements_version':'0'})
            check(file_count() == count_before, 'stale form persists no extra private files')
            fields = h.PROFILE | {'requirements_version':str(assignment['version']), 'answers[funds][income]':'Synthetic salaried income', 'answers[funds][notes]':'Synthetic explanation', 'answers[funds][date]':'2026-10-01', 'answers[funds][employment]':'Employed', 'answers[funds][attest]':'1', 'answers[residency][region]':'Synthetic Region'}
            files = h.FILES | {'answers[funds][proof]':('synthetic-proof.png','image/png',h.IMAGE)}
            for changes in [{'answers[funds][attest]':'0'},{'answers[funds][employment]':'Invalid'},{'answers[funds][date]':'2026-02-30'},{'answers[funds][unlisted]':'forbidden'}]:
                reset_limits(); member.upload(422, fields=fields | changes, files=files)
            reset_limits(); pending = member.upload(201, fields=fields, files=files)['kyc']
            check(pending['status'] == 'pending' and file_count() == count_before + 3, 'nested multipart custom inputs and supporting evidence submit for admin review')
            detail = admin.expect(200, f"/api/admin/kyc/{pending['submission_id']}")['submission']
            check('Synthetic salaried income' in json.dumps(detail), 'authorized review includes submitted custom answers')
            check('Synthetic salaried income' not in json.dumps(admin.expect(200, '/api/admin/kyc?status=pending')), 'queue omits custom answers')
            custom_documents = [document for kind, document in detail['documents'].items() if kind not in ('id_document', 'selfie')]
            check(len(custom_documents) == 1, 'review supplies a distinct authenticated link for additional evidence')
            custom_url = custom_documents[0]['download_url']
            other.expect(404, custom_url)
            status, _, headers, content = admin.request(custom_url)
            check(status == 200 and content == h.IMAGE and headers.get('Content-Disposition','').startswith('attachment;'), 'custom evidence uses protected attachment downloads')
            raw = sql('SELECT * FROM kyc_submissions WHERE id=?', (pending['submission_id'],))[0]
            check('Synthetic salaried income' not in json.dumps(raw), 'custom answers are encrypted in the database')
            changed = json.loads(json.dumps(current_settings)); changed['reason'] = 'Updated explanation for why we ask for verification.'
            admin.expect(200, '/api/admin/kyc/requirements', 'PUT', changed)
            check(member.expect(200, '/api/kyc')['kyc']['status'] == 'pending', 'editing explanation alone preserves existing verification state')
            changed = admin.expect(200, '/api/admin/kyc/requirements')['settings']; changed['layers'][0]['name'] = 'Enhanced funds review'
            admin.expect(200, '/api/admin/kyc/requirements', 'PUT', changed)
            unchanged_assignment = admin.expect(200, assign_url)['requirements']
            check(unchanged_assignment['version'] == assignment['version'] and unchanged_assignment['layers'][0]['name'] == 'Source of funds', 'template edits preserve assigned snapshots until admin explicitly reapplies')
            admin.expect(200, assign_url, 'PUT', {'version':assignment['version'],'layer_ids':assignment['layer_ids'],'reason':assignment['reason']})
            replacement_assignment = admin.expect(200, assign_url)['requirements']
            check(replacement_assignment['version'] > assignment['version'], 'reapplying an edited layer creates a new user requirements version')
            admin.expect(409, f"/api/admin/kyc/{pending['submission_id']}/review", 'POST', {'version':pending['version'],'decision':'approved'})
            check(member.expect(200, '/api/kyc')['kyc']['status'] == 'additional_required', 'outdated pending submission cannot approve newer requirements')
            reset_limits(); replacement = member.upload(201, fields=fields | {'requirements_version':str(replacement_assignment['version'])}, files=files)['kyc']
            admin.expect(200, f"/api/admin/kyc/{replacement['submission_id']}/review", 'POST', {'version':replacement['version'],'decision':'approved'})
            check(member.expect(200, '/api/kyc')['kyc']['status'] == 'approved', 'current complete layered verification can receive administrator approval')
            reset_limits(); member.expect(201, '/api/wallet/requests', 'POST', h.WITHDRAWAL | {'idempotency_key':'kyc-layers-approved-withdrawal'})
            check(sql('SELECT wallet_balance FROM users WHERE id=?', (member_id,))[0][0] == financial_before - 10000, 'current layer approval unlocks normal withdrawal reservation')
            audit = json.dumps(sql('SELECT action,reason,"before","after" FROM admin_audits'))
            check('Synthetic salaried income' not in audit and assignment['reason'] not in audit and '.enc' not in audit, 'audit feed omits custom answers, documents and individual explanation')
            for path in ['/api/session','/api/state']:
                response = member.expect(200, path)
                check('Synthetic salaried income' not in json.dumps(response) and assignment['reason'] not in json.dumps(response), 'ordinary account APIs omit custom identity details and private reason')
            check(other_id != member_id, 'test accounts remain distinct')
            print(f'PASS: {checks} layered KYC HTTP integration checks.')
        except Exception:
            log.flush(); log.seek(0)
            print(log.read()[-6000:])
            raise
        finally:
            server.terminate()
            try:
                server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server.kill(); server.wait(timeout=5)
            log.close()


if __name__ == '__main__':
    main()
