#!/usr/bin/env python3
"""Isolated real HTTP checks for admin-defined manual payment methods and fields."""
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
spec = importlib.util.spec_from_file_location('manual_http_helpers', ROOT / 'scripts/check-kyc-api.py')
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
        if '/manual-payment-methods' in path:
            check('no-store' in result[2].get('Cache-Control', ''), 'method responses and errors prevent caching')
        return result


def main():
    with tempfile.TemporaryDirectory(prefix='edge-manual-methods-') as directory:
        task = Path(directory); database = task / 'checks.sqlite'; database.touch()
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0)); port = listener.getsockname()[1]
        base = f'http://127.0.0.1:{port}'
        env = os.environ | {'APP_ENV':'local', 'APP_DEBUG':'false', 'APP_URL':base,
            'APP_KEY':'base64:' + base64.b64encode(os.urandom(32)).decode(),
            'DB_CONNECTION':'sqlite', 'DB_DATABASE':str(database), 'SESSION_DRIVER':'database',
            'CACHE_STORE':'database', 'CACHE_PREFIX':'edge-manual-check-', 'BCRYPT_ROUNDS':'4',
            'LOG_CHANNEL':'stderr', 'KYC_STORAGE_PATH':str(task / 'kyc'), 'EDGE_METHOD_TEST_ROOT':str(ROOT)}
        subprocess.run(['php','artisan','migrate','--force','--quiet'],cwd=ROOT,env=env,check=True)
        password = 'SyntheticManualAdminPassword123'
        subprocess.run(['php','artisan','edge:admin','admin@manual.test.invalid','--name=Synthetic Manual Admin','--password=' + password],cwd=ROOT,env=env,check=True,stdout=subprocess.DEVNULL)
        router = task / 'router.php'
        router.write_text("""<?php
define('LARAVEL_START', microtime(true));
require getenv('EDGE_METHOD_TEST_ROOT').'/vendor/autoload.php';
$app = require getenv('EDGE_METHOD_TEST_ROOT').'/bootstrap/app.php';
$app->make(Illuminate\\Contracts\\Http\\Kernel::class)->bootstrap();
Illuminate\\Support\\Facades\\Http::preventStrayRequests();
$app->handleRequest(Illuminate\\Http\\Request::capture());
""")
        log = open(task / 'server.log','w+')
        server = subprocess.Popen(['php','-S',f'127.0.0.1:{port}','-t',str(ROOT/'public'),str(router)],cwd=ROOT,env=env,stdout=log,stderr=log)
        def sql(query, params=()):
            with sqlite3.connect(database) as db: return db.execute(query,params).fetchall()
        def reset_limits(): sql('DELETE FROM cache')
        guest,admin,user,other = [Client(base) for _ in range(4)]
        definition = {'name':'Synthetic Mobile Money','instructions':'Pay to TEST-DESTINATION-001. Use only the test network.', 'enabled':True,'deposit_enabled':True,'withdrawal_enabled':True,
            'fields':[{'key':'f_number','label':'Mobile account number','type':'text','required':True,'hint':'Include country code','options':[]},
                {'key':'f_network','label':'Network','type':'select','required':True,'hint':'','options':['Test One','Test Two']},
                {'key':'f_email','label':'Receipt email','type':'email','required':'0','hint':'','options':[]}]}
        image = {'image':('synthetic-method.png','image/png',h.IMAGE)}
        def save(client, status, data, identifier=None, files=None, **kwargs):
            return client.expect(status,'/api/admin/manual-payment-methods'+(f'/{identifier}' if identifier else ''),'POST',fields={'definition':json.dumps(data),'current_password':kwargs.pop('password',password)},files=image if files is None and identifier is None else files or {},**kwargs)
        def balance(): return sql("SELECT wallet_balance FROM users WHERE email='member@manual.test.invalid'")[0][0]
        def request_payload(kind='deposit',key='manual-method-deposit-001',**changes):
            return {'type':kind,'amount_cents':20000,'method':f'manual:{method_id}','details':{'method_version':1,**({'reference':'SYNTHETIC-TRANSFER-001'} if kind=='deposit' else {'answers':{'f_number':'+1234567890','f_network':'Test One','f_email':'member@example.test'}})},'idempotency_key':key,**changes}
        try:
            for _ in range(100):
                try:
                    if guest.request('/api/session')[0] == 200: break
                except (OSError,urllib.error.URLError): time.sleep(.1)
            else: raise RuntimeError('Local test server did not start')
            guest.expect(401,'/api/admin/manual-payment-methods')
            for client,email in [(user,'member@manual.test.invalid'),(other,'other@manual.test.invalid')]:
                client.expect(200,'/api/session');client.expect(201,'/api/auth/register','POST',{'name':'Synthetic Manual Member','email':email,'password':password,'password_confirmation':password})
            admin.expect(200,'/api/session');admin.expect(200,'/api/auth/login','POST',{'email':'admin@manual.test.invalid','password':password})
            user.expect(403,'/api/admin/manual-payment-methods')
            save(user,403,definition)
            save(admin,419,definition,csrf=False)
            save(admin,422,definition,password='IncorrectPassword123')
            save(admin,422,definition,files={})
            save(admin,422,definition,files={'image':('fake.png','image/png',b'<svg onload="bad()"></svg>')})
            save(admin,422,definition,files={'image':('large.png','image/png',h.IMAGE + b'x'*1048576)})
            for invalid in [definition|{'fields':[]}, definition|{'name':''}, definition|{'enabled':False,'deposit_enabled':False,'withdrawal_enabled':False}, definition|{'unexpected':'test'}, definition|{'fields':[definition['fields'][0],definition['fields'][0]]},definition|{'fields':[definition['fields'][1]|{'options':['One','One']}]},definition|{'fields':[definition['fields'][0]|{'type':'password'}]}]:
                reset_limits();save(admin,422,invalid)
            check(sql('SELECT COUNT(*) FROM manual_payment_methods')[0][0]==0,'invalid methods create no records')
            created = save(admin,201,definition)['method'];method_id = created['id'];path=f'/api/admin/manual-payment-methods/{method_id}'
            check(created['version']==1 and created['name']==definition['name'],'admin creates image/name/instructions and withdrawal schema')
            check(created['fields'][2]['required'] is False,'field booleans normalize to native booleans for the wallet form')
            check('image_data' not in created,'JSON never includes encoded image storage')
            row=json.dumps(sql('SELECT instructions,fields,image_data FROM manual_payment_methods'))
            for private in ['TEST-DESTINATION-001','Mobile account number',base64.b64encode(h.IMAGE).decode()]: check(private not in row,'method configuration and images are encrypted in storage')
            public=user.expect(200,'/api/payment-methods')
            check(public['manual_catalog_configured'] and public['manual_methods'][0]['id']==method_id,'wallet receives enabled catalog')
            guest.expect(401,created['image_url'])
            code,body,headers,raw=user.request(created['image_url'])
            check(code==200 and raw==h.IMAGE and headers['Content-Type']=='image/png','real image endpoint returns uploaded image bytes')
            check(headers['X-Content-Type-Options']=='nosniff','images prevent content sniffing')
            legacy={'type':'deposit','amount_cents':20000,'method':'bank_transfer','details':{'reference':'LEGACY-BYPASS'},'idempotency_key':'manual-method-legacy-bypass'}
            user.expect(422,'/api/wallet/requests','POST',legacy)
            bad=request_payload(details={'method_version':1,'reference':'TEST','payment_destination':{'account_number':'FORGED'}})
            user.expect(422,'/api/wallet/requests','POST',bad)
            user.expect(409,'/api/wallet/requests','POST',request_payload(details={'method_version':99,'reference':'TEST'}))
            deposit=user.expect(201,'/api/wallet/requests','POST',request_payload())['request']
            check(balance()==0 and deposit['status']=='pending','deposit request never optimistically credits money')
            check(deposit['method_name']==definition['name'] and deposit['details']['manual_payment_method']['instructions']==definition['instructions'],'deposit snapshots verified admin destination')
            changed=definition|{'name':'Renamed Synthetic Method','instructions':'NEW-TEST-DESTINATION-002','version':1}
            save(admin,409,changed|{'version':50},method_id)
            save(admin,200,changed,method_id)
            retry=user.expect(201,'/api/wallet/requests','POST',request_payload())['request']
            check(retry['id']==deposit['id'] and retry['details']==deposit['details'],'retry after admin edit returns original snapshot without duplication')
            user.expect(409,'/api/wallet/requests','POST',request_payload(key='manual-deposit-stale-002'))
            admin.expect(200,f"/api/admin/wallet-requests/{deposit['id']}/review",'POST',{'decision':'approve','reference':'VERIFIED-MANUAL-DEPOSIT-001'})
            admin.expect(200,f"/api/admin/wallet-requests/{deposit['id']}/review",'POST',{'decision':'approve','reference':'VERIFIED-MANUAL-DEPOSIT-001'})
            check(balance()==20000,'verified deposit approval credits once')
            reset_limits()
            withdrawal=request_payload('withdrawal','manual-withdraw-001');withdrawal['amount_cents']=10000;withdrawal['details']['method_version']=2
            user.expect(422,'/api/wallet/requests','POST',withdrawal)
            check(balance()==20000,'KYC guard does not reserve unverified withdrawal')
            kyc=user.upload(201)['kyc'];admin.expect(200,f"/api/admin/kyc/{kyc['submission_id']}/review",'POST',{'version':kyc['version'],'decision':'approved'})
            for answers in [{}, {'f_number':'123','f_network':'Forged Network'}, {'f_number':['invalid'],'f_network':'Test One'}, {'f_number':'123','f_network':'Test One','f_email':'invalid-email'}, {'f_number':'123','f_network':'Test One','f_extra':'unexpected'}]:
                user.expect(422,'/api/wallet/requests','POST',withdrawal|{'details':{'method_version':2,'answers':answers}})
            check(balance()==20000,'invalid dynamic fields never reserve money')
            pending=user.expect(201,'/api/wallet/requests','POST',withdrawal)['request']
            check(balance()==10000 and pending['details']['answers']['f_number']=='+1234567890','valid configured withdrawal reserves exact money and preserves recipient details')
            check(pending['method_name']=='Renamed Synthetic Method','withdrawal snapshots current payment method name')
            encrypted=sql('SELECT details,manual_details FROM wallet_requests WHERE id=?',(pending['id'],))[0]
            check('+1234567890' not in ''.join(encrypted) and 'member@example.test' not in ''.join(encrypted),'recipient answers are encrypted at rest')
            check(other.expect(200,'/api/state')['wallet_requests']==[],'another account cannot read recipient details')
            disabled=changed|{'version':2,'enabled':False,'fields':[definition['fields'][0]|{'label':'New field label'}]}
            save(admin,200,disabled,method_id)
            check(user.expect(200,'/api/payment-methods')['manual_methods']==[],'disabled methods disappear from wallet selector')
            user.expect(404,created['image_url'])
            admin.expect(200,created['image_url'])
            history=user.expect(200,'/api/state')['wallet_requests'][0]
            check(history['details']==pending['details'],'method rename/field edit/disable cannot rewrite pending payout details')
            again=user.expect(201,'/api/wallet/requests','POST',withdrawal)['request']
            check(again['id']==pending['id'] and balance()==10000,'withdrawal retry after disabling method cannot reserve twice')
            user.expect(422,'/api/wallet/requests','POST',withdrawal|{'idempotency_key':'manual-disabled-withdraw-002'})
            reset_limits()
            user.expect(422,'/api/wallet/requests','POST',legacy|{'type':'withdrawal','details':{'bank_name':'Bank','account_name':'Member','account_number':'1234567890'},'idempotency_key':'manual-old-withdraw-bypass'})
            admin.expect(200,f"/api/admin/wallet-requests/{pending['id']}/review",'POST',{'decision':'reject','reference':'Synthetic withdrawal refund test'})
            check(balance()==20000,'withdrawal rejection refunds reserved amount once')
            overview=json.dumps(admin.expect(200,'/api/admin/overview'))
            for secret in ['+1234567890','member@example.test','TEST-DESTINATION-001',password]:check(secret not in overview,'audit summaries exclude payout details, method instructions and passwords')
            reset_limits()
            withdrawal_only=definition|{'name':'Payouts only','deposit_enabled':False}
            only=save(admin,201,withdrawal_only)['method']
            user.expect(422,'/api/wallet/requests','POST',request_payload(method='manual:'+str(only['id']),key='manual-direction-deposit-block',details={'method_version':1,'reference':'TEST'}))
            payout=withdrawal|{'method':'manual:'+str(only['id']),'details':withdrawal['details']|{'method_version':1},'idempotency_key':'manual-approve-payout-003'}
            payout=user.expect(201,'/api/wallet/requests','POST',payout)['request']
            admin.expect(200,f"/api/admin/wallet-requests/{payout['id']}/review",'POST',{'decision':'approve','reference':'VERIFIED-MANUAL-PAYOUT-003'})
            check(balance()==10000,'payout approval records completion without a second debit')
            check(sql('SELECT COUNT(*) FROM wallet_transactions')[0][0]==4,'funding, reservations and refund produce exactly four ledger entries')
            print(f'PASS: {checks} manual payment method HTTP checks.')
        except Exception:
            log.flush();log.seek(0);print(log.read()[-5000:]);raise
        finally:
            server.terminate()
            try:server.wait(timeout=5)
            except subprocess.TimeoutExpired:server.kill();server.wait(timeout=5)
            log.close()


if __name__=='__main__':main()
