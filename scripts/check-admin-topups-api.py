#!/usr/bin/env python3
"""Real OTP/CSRF/admin checks for direct top-ups. Isolated database and fake mail."""
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
ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('kyc',ROOT/'scripts/check-kyc-api.py');h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
Client,check=h.Client,h.check
with tempfile.TemporaryDirectory(prefix='edge-topup-http-') as directory:
    task=Path(directory);database=task/'test.sqlite';database.touch();Client.otp_mail=Path(str(database)+'.otp-mail.json')
    with socket.socket() as listener:listener.bind(('127.0.0.1',0));port=listener.getsockname()[1]
    base=f'http://127.0.0.1:{port}'
    env=os.environ|{'APP_ENV':'testing','APP_DEBUG':'false','APP_URL':base,'APP_KEY':'base64:'+base64.b64encode(os.urandom(32)).decode(),'DB_CONNECTION':'sqlite','DB_DATABASE':str(database),'SESSION_DRIVER':'database','CACHE_STORE':'database','BCRYPT_ROUNDS':'4','LOG_CHANNEL':'stderr','EDGE_TOPUP_ROOT':str(ROOT)}
    subprocess.run(['php','artisan','migrate','--force','--quiet'],cwd=ROOT,env=env,check=True)
    router=task/'router.php';router.write_text(r'''<?php
require getenv('EDGE_TOPUP_ROOT').'/vendor/autoload.php';
$app=require getenv('EDGE_TOPUP_ROOT').'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Http\Kernel::class)->bootstrap();
require getcwd().'/scripts/fixtures/capture-otp-mail.php';
$app->handleRequest(Illuminate\Http\Request::capture());
''')
    log=open(task/'server.log','w+');server=subprocess.Popen(['php','-S',f'127.0.0.1:{port}','-t',str(ROOT/'public'),str(router)],cwd=ROOT,env=env,stdout=log,stderr=log)
    def sql(query,params=()):
        with sqlite3.connect(database) as db:return db.execute(query,params).fetchall()
    def reset():sql('DELETE FROM cache')
    password='SyntheticAdminTopup123'
    try:
        guest=Client(base)
        for _ in range(100):
            try:
                if guest.request('/api/session')[0]==200:break
            except OSError:pass
            time.sleep(.1)
        for path in ['/api/admin/top-ups','/api/admin/top-ups/users']:
            status,body,headers,_=guest.request(path);check(status==401 and 'no-store' in headers.get('Cache-Control',''),'Guest top-up reads are protected and not cached')
        admin,member,other=Client(base),Client(base),Client(base);users=[]
        for i,client in enumerate([admin,member,other]):
            client.expect(200,'/api/session');result=client.expect(201,'/api/auth/register','POST',{'name':f'Topup Member {i}','email':f'member{i}@topup.test.invalid','password':password,'password_confirmation':password});users.append(result['user'])
        sql('UPDATE users SET is_admin=1 WHERE id=?',(users[0]['id'],))
        path=f"/api/admin/users/{users[1]['id']}/top-ups"
        payload={'account_number':users[1]['account_number'],'amount_cents':12345,'reason':'Synthetic private credit reason','current_password':password,'confirmed':True,'idempotency_key':'topup-http-key-001'}
        guest.expect(401,path,'POST',payload);member.expect(403,path,'POST',payload)
        member.expect(403,'/api/admin/top-ups');member.expect(403,'/api/admin/top-ups/users?search=member')
        results=admin.expect(200,'/api/admin/top-ups/users?search='+users[1]['account_number'])['users'];check(len(results)==1 and results[0]['id']==users[1]['id'],'Account-number search selects exact recipient')
        check(set(results[0])=={'id','name','email','account_number','balance_cents'},'Search has no credentials or private identity fields')
        check(len(admin.expect(200,'/api/admin/top-ups/users?search=member1')['users'])==1,'Email search works')
        admin.expect(422,'/api/admin/top-ups?user_id='+str(users[1]['id']))
        admin.expect(419,path,'POST',payload,csrf=False)
        for change in [{'current_password':'wrong'},{'amount_cents':0},{'amount_cents':-123},{'amount_cents':100.5},{'reason':'  '},{'confirmed':False},{'account_number':users[2]['account_number']},{'is_admin':True},{'user_id':users[2]['id']}]:
            reset();admin.expect(422,path,'POST',payload|change)
        check(sql('SELECT count(*) FROM admin_wallet_topups')[0][0]==0,'Rejected HTTP requests create no credits')
        reset();credit=admin.expect(201,path,'POST',payload);check(not credit['idempotent'],'First top-up is a new receipt')
        check(credit['topup']['user']['id']==users[1]['id'] and credit['topup']['amount_cents']==12345,'Receipt identifies the credited user and amount')
        retry=admin.expect(200,path,'POST',payload);check(retry['idempotent'] and retry['topup']['reference']==credit['topup']['reference'],'HTTP retry returns the original receipt')
        admin.expect(409,path,'POST',payload|{'amount_cents':20000})
        check(sql('SELECT wallet_balance FROM users WHERE id=?',(users[1]['id'],))[0][0]==12345,'Wallet credited once')
        state=member.expect(200,'/api/state');check(state['balance_cents']==12345 and state['transactions'][0]['type']=='admin_topup','User sees the admin top-up in ordinary wallet state')
        check(payload['reason'] not in str(state) and password not in str(state),'Private reason and password do not enter user responses')
        history=admin.expect(200,'/api/admin/top-ups')['topups'];check(len(history)==1 and history[0]['reason']==payload['reason'],'Only admin history includes the recorded reason')
        check('request_hash' not in str(history) and password not in str(history),'Admin receipts exclude hashes and passwords')
        overview=admin.expect(200,'/api/admin/overview');check(payload['reason'] not in str(overview),'General audit feed omits private free text')
        check(sql("SELECT count(*) FROM admin_audits WHERE action='wallet.admin_topup'")[0][0]==1,'Exactly one admin audit exists')
        admin.expect(404,'/api/admin/users/999999/top-ups','POST',payload)
        sql('UPDATE users SET is_admin=0 WHERE id=?',(users[0]['id'],));admin.expect(403,path,'POST',payload|{'idempotency_key':'after-demotion-key-001'})
        check(sql('SELECT count(*) FROM admin_wallet_topups')[0][0]==1,'Demotion and retries cannot create another top-up')
        print(f'PASS: {h.checks} admin top-up HTTP checks.')
    finally:
        server.terminate();server.wait(timeout=5);log.close()
