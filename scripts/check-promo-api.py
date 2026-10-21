#!/usr/bin/env python3
"""Disposable HTTP checks for withdrawable promotional wallet credit."""
import base64
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import socket
import sqlite3
import subprocess
import tempfile
import time
import urllib.error

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('promo_http_helpers', ROOT / 'scripts/check-kyc-api.py')
h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
checks = 0


def check(condition, message):
    global checks
    if not condition: raise AssertionError(message)
    checks += 1


h.check = check


class Client(h.Client):
    def request(self, path, *args, **kwargs):
        result = super().request(path, *args, **kwargs)
        if path.startswith('/api/promo-codes') or path.startswith('/api/admin/promo-codes'):
            check('no-store' in result[2].get('Cache-Control',''), 'promotion responses and errors cannot be cached')
            check(result[2].get('X-Content-Type-Options') == 'nosniff', 'promotion responses disable content sniffing')
        return result


def main():
    with tempfile.TemporaryDirectory(prefix='edge-promo-http-') as directory:
        task = Path(directory); database = task / 'checks.sqlite'; database.touch()
        with socket.socket() as listener:
            listener.bind(('127.0.0.1',0)); port = listener.getsockname()[1]
        base = f'http://127.0.0.1:{port}'
        env = os.environ | {
            'APP_ENV':'local','APP_DEBUG':'false','APP_URL':base,
            'APP_KEY':'base64:' + base64.b64encode(os.urandom(32)).decode(),
            'DB_CONNECTION':'sqlite','DB_DATABASE':str(database),'SESSION_DRIVER':'database',
            'CACHE_STORE':'database','CACHE_PREFIX':'edge-promo-http-','BCRYPT_ROUNDS':'4',
            'LOG_CHANNEL':'stderr','EDGE_PROMO_TEST_ROOT':str(ROOT),'KYC_STORAGE_PATH':str(task / 'kyc'),
        }
        subprocess.run(['php','artisan','migrate','--force','--quiet'],cwd=ROOT,env=env,check=True)
        password = 'SyntheticPromoPassword123'
        subprocess.run(['php','artisan','edge:admin','admin@promo.test.invalid','--name=Synthetic Promo Admin','--password=' + password],cwd=ROOT,env=env,check=True,stdout=subprocess.DEVNULL)
        router = task / 'router.php'
        router.write_text("""<?php
define('LARAVEL_START', microtime(true));
require getenv('EDGE_PROMO_TEST_ROOT').'/vendor/autoload.php';
$app = require getenv('EDGE_PROMO_TEST_ROOT').'/bootstrap/app.php';
$app->make(Illuminate\\Contracts\\Http\\Kernel::class)->bootstrap();
Illuminate\\Support\\Facades\\Http::preventStrayRequests();
$app->handleRequest(Illuminate\\Http\\Request::capture());
""")
        log = open(task / 'server.log','w+')
        server = subprocess.Popen(['php','-S','127.0.0.1:' + str(port),'-t',str(ROOT / 'public'),str(router)],cwd=ROOT,env=env,stdout=log,stderr=log)

        def sql(query, params=()):
            with sqlite3.connect(database) as connection: return connection.execute(query,params).fetchall()

        def reset_limits(): sql('DELETE FROM cache')

        def wallet_state(user_id):
            return [sql('SELECT wallet_balance FROM users WHERE id=?',(user_id,))[0][0],sql('SELECT COUNT(*) FROM wallet_transactions WHERE user_id=?',(user_id,))[0][0],sql('SELECT COUNT(*) FROM promo_code_redemptions WHERE user_id=?',(user_id,))[0][0]]

        try:
            guest = Client(base)
            for _ in range(100):
                try:
                    if guest.request('/api/session')[0] == 200: break
                except (OSError,urllib.error.URLError): time.sleep(.1)
            else: raise RuntimeError('Promotion HTTP server did not start')
            guest.expect(401,'/api/promo-codes'); guest.expect(401,'/api/admin/promo-codes')
            guest.expect(401,'/api/promo-codes/redeem','POST',{'code':'A1B2C3D4E5F6G7H8'})
            member,other,admin = Client(base),Client(base),Client(base)
            for client,email in [(member,'member@promo.test.invalid'),(other,'other@promo.test.invalid')]:
                client.expect(200,'/api/session');client.expect(201,'/api/auth/register','POST',{'name':'Synthetic Promo Member','email':email,'password':password,'password_confirmation':password})
            admin.expect(200,'/api/session');admin.expect(200,'/api/auth/login','POST',{'email':'admin@promo.test.invalid','password':password})
            member_id = sql('SELECT id FROM users WHERE email=?',('member@promo.test.invalid',))[0][0]
            other_id = sql('SELECT id FROM users WHERE email=?',('other@promo.test.invalid',))[0][0]
            issue = {'amount_cents':25000,'label':'Synthetic promotion','current_password':password,'idempotency_key':'promo-http-issue-0001'}
            member.expect(403,'/api/admin/promo-codes')
            member.expect(403,'/api/admin/promo-codes','POST',issue)
            admin.expect(419,'/api/admin/promo-codes','POST',issue,csrf=False)
            admin.expect(422,'/api/admin/promo-codes','POST',issue | {'current_password':'IncorrectPassword123'})
            for invalid in [{'amount_cents':99},{'amount_cents':100000001},{'amount_cents':25000.5},{'currency':'NGN'},{'code':'A1B2C3D4E5F6G7H8'},{'expires_at':'2000-01-01T00:00:00Z'}]:
                reset_limits();admin.expect(422,'/api/admin/promo-codes','POST',issue | invalid)
            created = admin.expect(201,'/api/admin/promo-codes','POST',issue)
            code = created['code']; identifier = created['promo_code']['id']
            check(bool(re.fullmatch('[A-Z0-9]{16}',code)) and re.search('[A-Z]',code) and re.search('[0-9]',code),'generated code has exactly sixteen letters and digits')
            check(created['promo_code']['amount_cents'] == 25000 and created['promo_code']['currency'] == 'USD','administrator sets exact dollar amount in cents')
            check(wallet_state(member_id) == [0,0,0],'issuing a code does not fund a wallet before redemption')
            replay = admin.expect(200,'/api/admin/promo-codes','POST',issue)
            check(replay['idempotent'] is True and replay['code'] == code,'issuance retry returns the same code without creating another liability')
            admin.expect(409,'/api/admin/promo-codes','POST',issue | {'amount_cents':26000})
            listed = admin.expect(200,'/api/admin/promo-codes?status=active&page=1')
            check(code not in json.dumps(listed) and code[-4:] in json.dumps(listed),'admin list masks redeemable code while retaining final four characters')
            check(code not in json.dumps(sql('SELECT * FROM promo_codes')),'full credit code is encrypted at rest')
            before = wallet_state(member_id)
            member.expect(419,'/api/promo-codes/redeem','POST',{'code':code},csrf=False)
            member.expect(422,'/api/promo-codes/redeem','POST',{'code':code,'amount_cents':99999999})
            check(wallet_state(member_id) == before,'invalid or forged redemption creates no wallet entries')
            redeemed = member.expect(200,'/api/promo-codes/redeem','POST',{'code':'  ' + code.lower() + '  '})
            check(redeemed['already_redeemed'] is False and redeemed['wallet_balance_cents'] == 25000,'signed-in member receives the exact promo value in spendable wallet balance')
            check(wallet_state(member_id) == [25000,1,1],'redemption credits one immutable ledger transaction and one redemption')
            transaction = member.expect(200,'/api/state')['transactions'][0]
            check(transaction['type'] == 'promo_credit' and transaction['amount_cents'] == 25000,'wallet history identifies promotional credit separately from payments and winnings')
            retry = member.expect(200,'/api/promo-codes/redeem','POST',{'code':code})
            check(retry['already_redeemed'] is True and wallet_state(member_id) == [25000,1,1],'owner retry cannot credit the code twice')
            other_before = wallet_state(other_id)
            unavailable = other.expect(422,'/api/promo-codes/redeem','POST',{'code':code})
            check(wallet_state(other_id) == other_before,'another account cannot spend an already redeemed code')
            history = member.expect(200,'/api/promo-codes')['redemptions']
            check(len(history) == 1 and history[0]['amount_cents'] == 25000 and code not in json.dumps(history),'owner redemption history shows amount and masked identity only')
            check(other.expect(200,'/api/promo-codes')['redemptions'] == [],'redemption history is specific to the authenticated account')
            member.expect(422,'/api/promo-codes?user_id=' + str(other_id))
            admin.expect(409,f'/api/admin/promo-codes/{identifier}/revoke','POST',{'version':created['promo_code']['version'],'current_password':password})
            withdrawal = {'type':'withdrawal','amount_cents':10000,'method':'bank','details':{'bank_name':'Test Bank','account_name':'Synthetic Promo Member','account_number':'1234567890'},'idempotency_key':'promo-unverified-withdraw-001'}
            member.expect(422,'/api/wallet/requests','POST',withdrawal)
            check(wallet_state(member_id) == [25000,1,1],'promotional funds remain withdrawable under the normal approval rules without bypassing KYC')
            kyc = member.upload(201)['kyc']
            admin.expect(200,f"/api/admin/kyc/{kyc['submission_id']}/review",'POST',{'version':kyc['version'],'decision':'approved'})
            event = admin.expect(201,'/api/admin/events','POST',{'sport':'football','league':'Synthetic promotion test','home_name':'Home Test','away_name':'Away Test','starts_at':(dt.datetime.now(dt.timezone.utc)+dt.timedelta(hours=3)).isoformat(),'status':'open','odds_home':'2.0','odds_draw':'3.2','odds_away':'2.5'})['event']
            member.expect(201,'/api/bets','POST',{'type':'single','stake_cents':1000,'idempotency_key':'promo-funded-stake-001','selections':[{'event_id':event['id'],'outcome':'home','expected_odds':event['odds_home'],'expected_version':event['version']}]})
            check(wallet_state(member_id)[0] == 24000,'promotional credit can fund a real stake')
            request = member.expect(201,'/api/wallet/requests','POST',withdrawal | {'idempotency_key':'promo-approved-withdraw-001'})['request']
            check(wallet_state(member_id)[0] == 14000,'approved KYC allows promotional funds to reserve for withdrawal')
            admin.expect(200,f"/api/admin/wallet-requests/{request['id']}/review",'POST',{'decision':'reject','reference':'Synthetic promo withdrawal refund'})
            check(wallet_state(member_id)[0] == 24000,'ordinary withdrawal rejection returns the promotional funds once')
            reset_limits()
            revocable = admin.expect(201,'/api/admin/promo-codes','POST',issue | {'idempotency_key':'promo-http-issue-revoke','amount_cents':5000})
            revoke_path = f"/api/admin/promo-codes/{revocable['promo_code']['id']}/revoke"
            member.expect(403,revoke_path,'POST',{'version':1,'current_password':password})
            admin.expect(422,revoke_path,'POST',{'version':1,'current_password':'WrongPassword123'})
            admin.expect(409,revoke_path,'POST',{'version':99,'current_password':password})
            revoked = admin.expect(200,revoke_path,'POST',{'version':1,'current_password':password})
            check(revoked['promo_code']['status'] == 'revoked','administrator can revoke an unused code with password confirmation')
            admin.expect(200,revoke_path,'POST',{'version':1,'current_password':password})
            before = wallet_state(other_id)
            revoked_error = other.expect(422,'/api/promo-codes/redeem','POST',{'code':revocable['code']})
            check(revoked_error == unavailable and wallet_state(other_id) == before,'revoked code is unavailable and cannot alter wallet funds')
            reset_limits()
            for _ in range(6): other.expect(422,'/api/promo-codes/redeem','POST',{'code':'INVALIDPROMO0000'})
            other.expect(429,'/api/promo-codes/redeem','POST',{'code':'INVALIDPROMO0000'})
            other.expect(422,'/api/wallet/requests','POST',withdrawal | {'idempotency_key':'promo-independent-throttle'})
            check(wallet_state(other_id) == before,'chat/code guessing rate limits do not affect balances or authorize financial actions')
            audit = json.dumps(admin.expect(200,'/api/admin/overview'))
            for secret in [code,revocable['code'],hashlib.sha256(code.encode()).hexdigest(),password]:
                check(secret not in audit,'general administrator overview and audit history exclude redeemable secrets and passwords')
            check(sql('SELECT COUNT(*) FROM promo_codes')[0][0] == 2,'validation, retries and revocation never issue unintended extra codes')
            print(f'PASS: {checks} promotional credit HTTP checks.')
        except Exception:
            log.flush();log.seek(0);print(log.read()[-6000:]);raise
        finally:
            server.terminate()
            try:server.wait(timeout=5)
            except subprocess.TimeoutExpired:server.kill();server.wait(timeout=5)
            log.close()


if __name__ == '__main__': main()
