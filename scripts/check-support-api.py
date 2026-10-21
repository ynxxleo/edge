#!/usr/bin/env python3
"""Exercise support chat through real authenticated HTTP, with disposable data."""
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
spec = importlib.util.spec_from_file_location('support_http_helpers', ROOT / 'scripts/check-kyc-api.py')
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)
checks = 0


def check(condition, message):
    global checks
    if not condition:
        raise AssertionError(message)
    checks += 1


h.check = check


class Client(h.Client):
    def request(self, path, *args, **kwargs):
        result = super().request(path, *args, **kwargs)
        if path.startswith('/api/support') or path.startswith('/api/admin/support'):
            check('no-store' in result[2].get('Cache-Control', ''), 'support responses and errors cannot be cached')
            check(result[2].get('X-Content-Type-Options') == 'nosniff', 'support responses disable content sniffing')
        return result


def main():
    with tempfile.TemporaryDirectory(prefix='edge-support-http-') as directory:
        task = Path(directory)
        database = task / 'checks.sqlite'; database.touch()
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0)); port = listener.getsockname()[1]
        base = f'http://127.0.0.1:{port}'
        Client.otp_mail = Path(str(database) + '.otp-mail.json')
        env = os.environ | {
            'APP_ENV':'local','APP_DEBUG':'false','APP_URL':base,
            'APP_KEY':'base64:' + base64.b64encode(os.urandom(32)).decode(),
            'DB_CONNECTION':'sqlite','DB_DATABASE':str(database),'SESSION_DRIVER':'database',
            'CACHE_STORE':'database','CACHE_PREFIX':'edge-support-http-','BCRYPT_ROUNDS':'4',
            'LOG_CHANNEL':'stderr','EDGE_SUPPORT_TEST_ROOT':str(ROOT),
        }
        subprocess.run(['php','artisan','migrate','--force','--quiet'], cwd=ROOT, env=env, check=True)
        password = 'SyntheticSupportPassword123'
        for email in ['admin@support.test.invalid','second@support.test.invalid']:
            subprocess.run(['php','artisan','edge:admin',email,'--name=Synthetic Support Admin','--password=' + password], cwd=ROOT, env=env, check=True, stdout=subprocess.DEVNULL)
        router = task / 'router.php'
        router.write_text("""<?php
define('LARAVEL_START', microtime(true));
require getenv('EDGE_SUPPORT_TEST_ROOT').'/vendor/autoload.php';
$app = require getenv('EDGE_SUPPORT_TEST_ROOT').'/bootstrap/app.php';
$app->make(Illuminate\\Contracts\\Http\\Kernel::class)->bootstrap();
require getcwd().'/scripts/fixtures/capture-otp-mail.php';
Illuminate\\Support\\Facades\\Http::preventStrayRequests();
$app->handleRequest(Illuminate\\Http\\Request::capture());
""")
        log = open(task / 'server.log','w+')
        server = subprocess.Popen(['php','-S','127.0.0.1:' + str(port),'-t',str(ROOT / 'public'),str(router)], cwd=ROOT, env=env, stdout=log, stderr=log)

        def sql(query, params=()):
            with sqlite3.connect(database) as connection:
                return connection.execute(query, params).fetchall()

        def reset_limits():
            sql('DELETE FROM cache')

        try:
            guest = Client(base)
            for _ in range(100):
                try:
                    if guest.request('/api/session')[0] == 200: break
                except (OSError, urllib.error.URLError): time.sleep(0.1)
            else: raise RuntimeError('Support HTTP test server did not start')
            guest.expect(401,'/api/support')
            guest.expect(401,'/api/admin/support')
            guest.expect(419,'/api/support/conversations','POST',{},csrf=False)
            member,other,admin,second = Client(base),Client(base),Client(base),Client(base)
            for client,email in [(member,'member@support.test.invalid'),(other,'other@support.test.invalid')]:
                client.expect(200,'/api/session')
                client.expect(201,'/api/auth/register','POST',{'name':'Synthetic Member','email':email,'password':password,'password_confirmation':password})
            for client,email in [(admin,'admin@support.test.invalid'),(second,'second@support.test.invalid')]:
                client.expect(200,'/api/session');client.expect(200,'/api/auth/login','POST',{'email':email,'password':password})
            member_id = sql('SELECT id FROM users WHERE email=?',('member@support.test.invalid',))[0][0]
            sql('UPDATE users SET wallet_balance=123456 WHERE id=?',(member_id,))
            check(member.expect(200,'/api/support')['conversation'] is None,'opening support does not create unwanted conversations')
            member.expect(403,'/api/admin/support')
            member.expect(422,'/api/support/conversations','POST',{'user_id':999})
            first = member.expect((200,201),'/api/support/conversations','POST',{})['conversation']
            identifier = first['id']; path = f'/api/support/conversations/{identifier}'
            check(first['status'] == 'bot','new conversation begins with automated support')
            check(member.expect((200,201),'/api/support/conversations','POST',{})['conversation']['id'] == identifier,'repeated start reuses active conversation')
            other.expect((403,404),path)
            other.expect((403,404),path + '/messages','POST',{'body':'Other person request','idempotency_key':'support-other-owner-001'})
            member.expect(419,path + '/messages','POST',{'body':'Balance','idempotency_key':'support-csrf-001'},csrf=False)
            member.expect(422,path + '/messages','POST',{'body':'Balance','idempotency_key':'support-unknown-001','role':'admin'})
            member.expect(422,path + '/messages','POST',{'body':'x' * 2001,'idempotency_key':'support-too-long-001'})
            payload = {'body':'What is my wallet balance?','idempotency_key':'support-wallet-question-001'}
            answered = member.expect((200,201),path + '/messages','POST',payload)['conversation']
            check('1,234.56' in json.dumps(answered),'assistant uses current owner wallet balance in dollars')
            check('other@support.test.invalid' not in json.dumps(answered),'account answers do not expose another member')
            replay = member.expect((200,201),path + '/messages','POST',payload)['conversation']
            check([message['id'] for message in replay['messages']] == [message['id'] for message in answered['messages']],'message retry cannot duplicate question or answer')
            member.expect((409,422),path + '/messages','POST',payload | {'body':'Changed question'})
            member.expect((200,201),path + '/messages','POST',{'body':'What is my verification status?','idempotency_key':'support-kyc-question-001'})
            queued = member.expect((200,201),path + '/messages','POST',{'body':'How do I deposit?','idempotency_key':'support-deposit-question-001'})['conversation']
            check(queued['status'] == 'waiting','three automated account questions hand the conversation to an admin')
            assistants_before = [message['id'] for message in queued['messages'] if message['role'] == 'assistant']
            queued = member.expect((200,201),path + '/messages','POST',{'body':'Synthetic private support follow-up.','idempotency_key':'support-followup-question-001'})['conversation']
            check([message['id'] for message in queued['messages'] if message['role'] == 'assistant'] == assistants_before,'assistant stays silent after handoff')
            member.expect((200,201),path + '/handover','POST',{})
            inbox = admin.expect(200,'/api/admin/support?status=waiting&page=1')
            check(identifier in [row['id'] for row in inbox['conversations']],'waiting conversation appears in admin inbox')
            member.expect(403,f'/api/admin/support/{identifier}')
            member.expect(403,f'/api/admin/support/{identifier}/claim','POST',{'version':queued['version']})
            record = admin.expect(200,f'/api/admin/support/{identifier}')['conversation']
            second.expect((403,409),f'/api/admin/support/{identifier}/reply','POST',{'version':record['version'],'body':'Unclaimed reply','idempotency_key':'support-unclaimed-reply-001'})
            claimed = admin.expect(200,f'/api/admin/support/{identifier}/claim','POST',{'version':record['version']})['conversation']
            check(claimed['status'] == 'admin','administrator explicitly takes over the conversation')
            second.expect((403,409),f'/api/admin/support/{identifier}/claim','POST',{'version':record['version']})
            second.expect((403,409),f'/api/admin/support/{identifier}/reply','POST',{'version':claimed['version'],'body':'Wrong admin reply','idempotency_key':'support-wrong-admin-001'})
            reply = {'version':claimed['version'],'body':'Synthetic administrator reply: I am reviewing your request.','idempotency_key':'support-admin-reply-001'}
            replied = admin.expect((200,201),f'/api/admin/support/{identifier}/reply','POST',reply)['conversation']
            admin.expect((200,201),f'/api/admin/support/{identifier}/reply','POST',reply)
            visible = member.expect(200,path)['conversation']
            check(any(message['body'] == reply['body'] and message['role'] == 'admin' for message in visible['messages']),'user receives administrator reply in the same conversation')
            check(sum(message['body'] == reply['body'] for message in visible['messages']) == 1,'admin retry persists exactly one reply')
            admin.expect(409,f'/api/admin/support/{identifier}/resolve','POST',{'version':record['version']})
            resolved = admin.expect(200,f'/api/admin/support/{identifier}/resolve','POST',{'version':replied['version']})['conversation']
            check(resolved['status'] == 'resolved','assigned admin can resolve current conversation version')
            member.expect(409,path + '/messages','POST',{'body':'Cannot write resolved history','idempotency_key':'support-resolved-write-001'})
            next_chat = member.expect((200,201),'/api/support/conversations','POST',{})['conversation']
            check(next_chat['id'] != identifier,'a new conversation can start after resolution')
            next_path = f"/api/support/conversations/{next_chat['id']}"
            urgent = member.expect((200,201),next_path + '/messages','POST',{'body':'There is an unauthorized withdrawal on my account.','idempotency_key':'support-security-handoff-001'})['conversation']
            check(urgent['status'] == 'waiting','sensitive account concern goes directly to a human administrator')
            raw_messages = json.dumps(sql('SELECT * FROM support_messages'))
            check('Synthetic private support follow-up.' not in raw_messages and reply['body'] not in raw_messages,'private chat content is encrypted at rest')
            audits = json.dumps(sql('SELECT action,reason,"before","after" FROM admin_audits'))
            check('Synthetic private support follow-up.' not in audits and reply['body'] not in audits,'general audit feed omits private support messages')
            check(sql('SELECT wallet_balance FROM users WHERE id=?',(member_id,))[0][0] == 123456,'support cannot change wallet balance')
            for table in ['wallet_requests','wallet_transactions','bets','copy_positions','stripe_payments']:
                check(sql('SELECT COUNT(*) FROM ' + table)[0][0] == 0,'support creates no financial records in ' + table)
            reset_limits()
            print(f'PASS: {checks} support HTTP integration checks.')
        except Exception:
            log.flush();log.seek(0);print(log.read()[-6000:]);raise
        finally:
            server.terminate()
            try:server.wait(timeout=5)
            except subprocess.TimeoutExpired:server.kill();server.wait(timeout=5)
            log.close()


if __name__ == '__main__':
    main()
