#!/usr/bin/env python3
"""Exercise transfers with actual session/CSRF/OTP auth and disposable funds."""
import base64
import importlib.util
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import tempfile
import time

ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('kyc',ROOT/'scripts/check-kyc-api.py')
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
Client,check=h.Client,h.check
with tempfile.TemporaryDirectory(prefix='edge-transfer-http-') as directory:
    task=Path(directory);database=task/'test.sqlite';database.touch()
    Client.otp_mail=Path(str(database)+'.otp-mail.json')
    with socket.socket() as listener:listener.bind(('127.0.0.1',0));port=listener.getsockname()[1]
    base=f'http://127.0.0.1:{port}'
    env=os.environ|{'APP_ENV':'testing','APP_DEBUG':'false','APP_URL':base,'APP_KEY':'base64:'+base64.b64encode(os.urandom(32)).decode(),'DB_CONNECTION':'sqlite','DB_DATABASE':str(database),'SESSION_DRIVER':'database','CACHE_STORE':'database','BCRYPT_ROUNDS':'4','LOG_CHANNEL':'stderr','EDGE_TRANSFER_ROOT':str(ROOT)}
    subprocess.run(['php','artisan','migrate','--force','--quiet'],cwd=ROOT,env=env,check=True)
    router=task/'router.php'
    router.write_text(r'''<?php
require getenv('EDGE_TRANSFER_ROOT').'/vendor/autoload.php';
$app=require getenv('EDGE_TRANSFER_ROOT').'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Http\Kernel::class)->bootstrap();
require getcwd().'/scripts/fixtures/capture-otp-mail.php';
$app->handleRequest(Illuminate\Http\Request::capture());
''')
    log=open(task/'server.log','w+')
    server=subprocess.Popen(['php','-S',f'127.0.0.1:{port}','-t',str(ROOT/'public'),str(router)],cwd=ROOT,env=env,stdout=log,stderr=log)
    def sql(query,params=()):
        with sqlite3.connect(database) as db:return db.execute(query,params).fetchall()
    def reset():sql('DELETE FROM cache')
    password='SyntheticTransferPassword123'
    try:
        guest=Client(base)
        for _ in range(100):
            try:
                if guest.request('/api/session')[0]==200:break
            except OSError:pass
            time.sleep(.1)
        for path,method,data in [('/api/wallet/transfers','GET',None),('/api/wallet/transfers/recipient','POST',{'account_number':'1234567890'}),('/api/wallet/transfers','POST',{})]:
            result=guest.request(path,method,data);check(result[0]==401 and 'no-store' in result[2].get('Cache-Control',''),'Guests cannot access transfer data')
        sender,recipient,other=Client(base),Client(base),Client(base)
        users=[]
        for index,client in enumerate([sender,recipient,other]):
            client.expect(200,'/api/session');session=client.expect(201,'/api/auth/register','POST',{'name':f'Synthetic Member {index}','email':f'member{index}@transfer.test.invalid','password':password,'password_confirmation':password});users.append(session['user'])
        number=users[1]['account_number']
        check(len(number)==10 and number!=users[0]['account_number'],'New accounts expose unique internal numbers')
        sender.expect(419,'/api/wallet/transfers/recipient','POST',{'account_number':number},csrf=False)
        sender.expect(422,'/api/wallet/transfers/recipient','POST',{'account_number':users[0]['account_number']})
        sender.expect(422,'/api/wallet/transfers/recipient','POST',{'account_number':number,'email':'unexpected@example.test'})
        preview=sender.expect(200,'/api/wallet/transfers/recipient','POST',{'account_number':number})
        check(set(preview['recipient'])=={'name','account_number'},'Recipient discovery discloses only masked name and account number')
        request={'account_number':number,'amount_cents':1234,'confirmation_token':preview['confirmation_token'],'current_password':password,'idempotency_key':'http-transfer-check'}
        sender.expect(422,'/api/wallet/transfers','POST',request)
        sql('UPDATE users SET wallet_balance=10000 WHERE id=?',(users[0]['id'],))
        sql("INSERT INTO kyc_submissions (user_id,status,version,requirements_version,consented_at,reviewed_by,reviewed_at,created_at,updated_at) VALUES (?,'approved',2,0,CURRENT_TIMESTAMP,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",(users[0]['id'],users[2]['id']))
        sender.expect(419,'/api/wallet/transfers','POST',request,csrf=False)
        sender.expect(422,'/api/wallet/transfers','POST',request|{'current_password':'wrong'})
        sender.expect(422,'/api/wallet/transfers','POST',request|{'sender_id':users[2]['id']})
        reset()
        result=sender.expect(201,'/api/wallet/transfers','POST',request)['transfer']
        check(result['status']=='completed' and result['amount_cents']==1234,'Successful request returns completed receipt')
        sender.expect(201,'/api/wallet/transfers','POST',request)
        check(sql('SELECT wallet_balance FROM users WHERE id=?',(users[0]['id'],))[0][0]==8766,'HTTP retry debits once')
        check(sql('SELECT wallet_balance FROM users WHERE id=?',(users[1]['id'],))[0][0]==1234,'Recipient receives exact cents')
        sender.expect(422,'/api/wallet/transfers','POST',request|{'amount_cents':2000})
        for client,direction in [(sender,'sent'),(recipient,'received')]:
            history=client.expect(200,'/api/wallet/transfers');check(len(history['transfers'])==1 and history['transfers'][0]['direction']==direction,'Owner receives their side of transfer history')
            check(password not in str(history) and 'confirmation_token' not in str(history) and 'request_hash' not in str(history),'History excludes credentials and private request fields')
        check(other.expect(200,'/api/wallet/transfers')['transfers']==[],'Other users cannot see this transfer')
        other.expect(422,'/api/wallet/transfers?sender_id='+str(users[0]['id']))
        state=sender.expect(200,'/api/state');check(state['transactions'][0]['type']=='transfer_out' and state['balance_cents']==8766,'Existing wallet state shows transfer ledger entries')
        check(recipient.expect(200,'/api/state')['transactions'][0]['type']=='transfer_in','Recipient wallet state shows credit')
        reset()
        for _ in range(10):sender.expect(200,'/api/wallet/transfers/recipient','POST',{'account_number':number})
        sender.expect(429,'/api/wallet/transfers/recipient','POST',{'account_number':number})
        check(sql('SELECT count(*) FROM wallet_transfers')[0][0]==1,'Validation, limits and retries create no duplicate transfers')
        print(f'PASS: {h.checks} transfer HTTP checks.')
    finally:
        server.terminate();server.wait(timeout=5);log.close()
