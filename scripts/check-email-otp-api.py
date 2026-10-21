#!/usr/bin/env python3
"""Disposable HTTP OTP checks. Mail stays in an array transport; no email is sent."""
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

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('kyc', ROOT / 'scripts/check-kyc-api.py')
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
Client, check = helper.Client, helper.check

with tempfile.TemporaryDirectory(prefix='edge-otp-') as directory:
    task = Path(directory)
    database = task / 'test.sqlite'
    database.touch()
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    base = f'http://127.0.0.1:{port}'
    env = os.environ | {'APP_ENV': 'testing', 'APP_DEBUG': 'false', 'APP_URL': base,
        'APP_KEY': 'base64:' + base64.b64encode(os.urandom(32)).decode(),
        'DB_CONNECTION': 'sqlite', 'DB_DATABASE': str(database), 'SESSION_DRIVER': 'database',
        'SESSION_ENCRYPT': 'true', 'CACHE_STORE': 'database', 'CACHE_PREFIX': 'otp-test-',
        'BCRYPT_ROUNDS': '4', 'MAIL_MAILER': 'array', 'LOG_CHANNEL': 'stderr',
        'EDGE_OTP_ROOT': str(ROOT), 'EDGE_OTP_MAIL': str(task / 'mail.json')}
    subprocess.run(['php', 'artisan', 'migrate', '--force', '--quiet'], cwd=ROOT, env=env, check=True)
    router = task / 'router.php'
    router.write_text(r'''<?php
require getenv('EDGE_OTP_ROOT').'/vendor/autoload.php';
$app = require getenv('EDGE_OTP_ROOT').'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Http\Kernel::class)->bootstrap();
Illuminate\Support\Facades\Event::listen(Illuminate\Mail\Events\MessageSending::class, function ($event) {
    if (file_exists(getenv('EDGE_OTP_MAIL').'.fail')) { throw new RuntimeException('Synthetic mail failure'); }
    preg_match('/letter-spacing:8px">([0-9]{6})</', $event->message->getHtmlBody(), $match);
    file_put_contents(getenv('EDGE_OTP_MAIL'), json_encode(['code' => $match[1], 'recipient' => $event->message->getTo()[0]->getAddress()]));
});
$app->handleRequest(Illuminate\Http\Request::capture());
''')
    log = open(task / 'server.log', 'w+')
    server = subprocess.Popen(['php', '-S', f'127.0.0.1:{port}', '-t', str(ROOT / 'public'), str(router)], cwd=ROOT, env=env, stdout=log, stderr=log)
    def sql(query, params=()):
        with sqlite3.connect(database) as connection:
            return connection.execute(query, params).fetchall()
    def limits():
        sql('DELETE FROM cache')
    def code():
        return json.loads((task / 'mail.json').read_text())['code']
    password = 'SyntheticOtpPassword123'
    signup = {'name': 'OTP Member', 'email': 'member@otp.test.invalid', 'password': password, 'password_confirmation': password}
    try:
        member = Client(base)
        for _ in range(100):
            try:
                if member.request('/api/session')[0] == 200:
                    break
            except OSError:
                pass
            time.sleep(.1)
        member.expect(419, '/api/auth/register', 'POST', signup, csrf=False)
        challenge = member.expect(202, '/api/auth/register', 'POST', signup)
        first = code()
        check(first not in json.dumps(challenge) and 'password' not in json.dumps(challenge), 'challenge never exposes code or credentials')
        check(sql('SELECT count(*) FROM users')[0][0] == 0, 'signup does not create an account before verification')
        member.expect(401, '/api/state')
        member.expect(422, '/api/auth/resend', 'POST', {})
        other = Client(base)
        other.expect(200, '/api/session')
        other.expect(422, '/api/auth/verify', 'POST', {'code': first})
        member.expect(422, '/api/auth/verify', 'POST', {'code': 'abc123'})
        wrong = '000000'
        for _ in range(5):
            member.expect(422, '/api/auth/verify', 'POST', {'code': wrong})
        member.expect(422, '/api/auth/verify', 'POST', {'code': first})
        check(sql('SELECT attempts FROM auth_challenges')[0][0] == 5, 'five incorrect codes lock the challenge')
        limits()
        member.expect(200, '/api/auth/resend', 'POST', {})
        second = code()
        check(sql('SELECT count(*) FROM auth_challenges')[0][0] == 1, 'resend invalidates the previous challenge')
        stored = str(sql('SELECT payload,code_hash FROM auth_challenges'))
        check(second not in stored and signup['email'] not in stored and password not in stored, 'pending registration is encrypted and code is hashed')
        verified = member.expect(200, '/api/auth/verify', 'POST', {'code': second})
        check(verified['user']['email'] == signup['email'], 'verification signs in the pending account')
        check(sql('SELECT email_verified_at FROM users')[0][0] is not None, 'email marked verified')
        member.expect(200, '/api/state')
        member.expect(422, '/api/auth/verify', 'POST', {'code': second})
        member.expect(200, '/api/auth/logout', 'POST', {})
        limits()
        member.expect(422, '/api/auth/login', 'POST', {'email': signup['email'], 'password': 'wrong'})
        check(sql('SELECT count(*) FROM auth_challenges')[0][0] == 0, 'wrong password sends no challenge')
        login = {'email': signup['email'], 'password': password}
        member.expect(202, '/api/auth/login', 'POST', login)
        third = code()
        member.expect(401, '/api/state')
        check(member.expect(200, '/api/session')['auth_challenge']['requires_otp'], 'challenge can resume after page refresh')
        sql("UPDATE auth_challenges SET expires_at='2000-01-01 00:00:00'")
        member.expect(422, '/api/auth/verify', 'POST', {'code': third})
        limits()
        member.expect(200, '/api/auth/resend', 'POST', {})
        verified = member.expect(200, '/api/auth/verify', 'POST', {'code': code()})
        check(verified['user']['id'] == 1 and sql('SELECT count(*) FROM users')[0][0] == 1, 'login returns existing account without duplicates')
        member.expect(200, '/api/auth/logout', 'POST', {})
        limits()
        sql('UPDATE users SET is_admin=1')
        member.expect(202, '/api/auth/login', 'POST', login)
        member.expect(401, '/api/admin/overview')
        member.expect(200, '/api/auth/verify', 'POST', {'code': code()})
        member.expect(200, '/api/admin/overview')
        member.expect(200, '/api/auth/logout', 'POST', {})
        limits()
        member.expect(202, '/api/auth/login', 'POST', login)
        pending_code = code()
        sql("UPDATE users SET password='changed-password-hash'")
        member.expect(422, '/api/auth/verify', 'POST', {'code': pending_code})
        check(member.expect(200, '/api/session')['user'] is None, 'password changes invalidate pending login codes')
        limits()
        (task / 'mail.json.fail').touch()
        member.expect(503, '/api/auth/register', 'POST', signup | {'email': 'failure@otp.test.invalid'})
        check(sql('SELECT count(*) FROM auth_challenges')[0][0] == 0, 'mail failure leaves no usable challenge')
        check(sql('SELECT count(*) FROM users')[0][0] == 1, 'mail failure creates no account')
        check(member.expect(200, '/api/session')['user'] is None, 'mail failure never signs in a user')
        print(f'PASS: {helper.checks} email OTP HTTP checks.')
    finally:
        server.terminate()
        server.wait(timeout=5)
        log.close()
