#!/usr/bin/env node
/* Private synthetic support chats; no real network or provider requests. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM,VirtualConsole}=require(process.env.EDGE_JSDOM_PATH||'jsdom');
const root=path.resolve(__dirname,'..');
const markup=fs.readFileSync(path.join(root,'resources/views/partials/support.blade.php'),'utf8');
const adminMarkup=fs.readFileSync(path.join(root,'resources/views/partials/admin.blade.php'),'utf8');
const code=fs.readFileSync(path.join(root,'public/assets/support.js'),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
const flush=async()=>{for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve));};
const customer={id:2,name:'Synthetic Member',email:'member@example.test',is_admin:false};
const message=(id,role='assistant',body='Synthetic support answer')=>({id,role,body,sender_name:role==='admin'?'Test Administrator':'Built-in account assistant',automation_mode:role==='assistant'?'local':null,created_at:'2026-10-18T12:00:00Z'});
const conversation=(changes={})=>({id:7,status:'bot',version:1,bot_answers:0,messages:[message(1)],has_more:false,before_id:1,assigned_admin:null,user:customer,...changes});

async function setup(options={}){
  const calls=[],errors=[],auth=[],vc=new VirtualConsole();vc.on('jsdomError',error=>errors.push(error.message));
  const dom=new JSDOM(`<!doctype html><body>${adminMarkup}<button data-support-open>Help & support</button>${markup}</body>`,{url:'http://localhost:8135/app',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc});
  const w=dom.window,$=selector=>{const element=w.document.querySelector(selector);assert.ok(element,`Missing ${selector}`);return element;},$$=selector=>[...w.document.querySelectorAll(selector)];
  let user=options.user===undefined?(options.admin?{id:1,name:'Test Administrator',is_admin:true}:customer):options.user;
  let current=options.conversation?clone(options.conversation):null,thread=conversation({status:'waiting',version:4,...options.thread});
  const timed=new Map();let timerID=10000,hidden=false;
  const originalSet=w.setTimeout.bind(w),originalClear=w.clearTimeout.bind(w);
  w.setTimeout=(fn,delay,...args)=>delay===6000?(timed.set(++timerID,()=>fn(...args)),timerID):originalSet(fn,delay,...args);
  w.clearTimeout=id=>{if(!timed.delete(id))originalClear(id);};
  Object.defineProperty(w.document,'hidden',{get:()=>hidden});
  const assistant={mode:'local',label:'Built-in account assistant'};
  w.EdgeAPI={serverMode:options.serverMode!==false,get user(){return user;},openAuth:mode=>auth.push(mode),request:async(url,opts={})=>{
    calls.push({url,...opts});
    if(options.handle){const result=await options.handle(url,opts);if(result!==undefined)return result;}
    const body=typeof opts.body==='string'?JSON.parse(opts.body):opts.body||{};
    if(url==='/api/support')return {conversation:clone(current),assistant};
    if(url==='/api/support/conversations'&&opts.method==='POST'){current=conversation({id:current?.status==='resolved'?8:7});return {conversation:clone(current),assistant};}
    if(/^\/api\/support\/conversations\/\d+\/messages$/.test(url)){
      current||=conversation();const last=Math.max(0,...current.messages.map(m=>m.id));current.messages.push(message(last+1,'user',body.body));
      if(current.status==='bot'){current.messages.push(message(last+2));current.bot_answers++;if(current.bot_answers===3)current.status='waiting';}
      current.version++;return {conversation:clone(current),assistant};
    }
    if(url.endsWith('/handover')){current.status='waiting';current.version++;return {conversation:clone(current),assistant};}
    if(url.startsWith('/api/admin/support?'))return {conversations:[clone(thread)],pagination:{current_page:1,last_page:1,total:1}};
    if(url==='/api/admin/support/7')return {conversation:clone(thread),assistant};
    if(url==='/api/admin/support/7/claim'){thread.status='admin';thread.assigned_admin={id:1,name:'Test Administrator'};thread.version++;return {conversation:clone(thread),assistant};}
    if(url==='/api/admin/support/7/reply'){thread.messages.push(message(Math.max(...thread.messages.map(m=>m.id))+1,'admin',body.body));thread.version++;return {conversation:clone(thread),assistant};}
    if(url==='/api/admin/support/7/resolve'){thread.status='resolved';thread.version++;return {conversation:clone(thread),assistant};}
    throw new Error(`Unexpected ${opts.method||'GET'} ${url}`);
  }};
  $('#admin-workspace').hidden=!options.admin;$('#admin-page').hidden=true;
  w.eval(code);w.document.dispatchEvent(new w.Event('DOMContentLoaded'));await flush();
  const click=async selector=>{$(selector).click();await flush();};
  const set=(selector,value)=>{$(selector).value=value;$(selector).dispatchEvent(new w.Event('input',{bubbles:true}));};
  const submit=async(selector='#support-chat-form')=>{$(selector).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await flush();};
  const session=next=>{user=next;w.dispatchEvent(new w.CustomEvent('edge:session',{detail:{serverMode:options.serverMode!==false,user:next}}));};
  async function openAdmin(){ $('#admin-page').hidden=false;w.dispatchEvent(new w.CustomEvent('edge:navigate',{detail:{page:'admin'}}));w.dispatchEvent(new w.CustomEvent('edge:admin-tab',{detail:{tab:'support'}}));await flush();}
  async function tick(){const next=timed.entries().next().value;if(next){timed.delete(next[0]);await next[1]();await flush();}}
  return{w,$,$$,calls,errors,auth,click,set,submit,session,openAdmin,tick,timers:timed,setHidden:async value=>{hidden=value;w.document.dispatchEvent(new w.Event('visibilitychange'));await flush();},close:()=>dom.window.close()};
}
let passed=0,failed=0;
async function test(name,run,options){if(process.env.EDGE_CHECK_FILTER&&!name.toLowerCase().includes(process.env.EDGE_CHECK_FILTER.toLowerCase()))return;let a;try{a=await setup(options);await run(a);assert.deepEqual(a.errors,[]);console.log(`PASS ${name}`);passed++;}catch(error){console.error(`FAIL ${name}: ${error.stack}`);failed++;}finally{a?.close();}}
(async()=>{
  await test('Closed support makes no requests and opens through footer action',async a=>{assert.equal(a.calls.length,0);await a.click('[data-support-open]');assert.equal(a.$('#support-panel').hidden,false);assert.equal(a.calls[0].url,'/api/support');assert.equal(a.calls.filter(c=>c.method==='POST').length,0);});
  await test('Guests see sign-in and cannot send account messages',async a=>{await a.click('#support-launcher');assert.equal(a.calls.length,0);assert.equal(a.$('#support-footer').hidden,true);await a.click('[data-support-signin]');assert.deepEqual(a.auth,['login']);},{user:null});
  await test('Static preview is read-only and never fetches private chats',async a=>{await a.click('#support-launcher');assert.equal(a.calls.length,0);assert.match(a.$('#support-guest').textContent,/read-only preview/i);},{serverMode:false});
  await test('Quick question starts conversation and sends text with a retry key',async a=>{await a.click('#support-launcher');await a.click('[data-support-question="0"]');const start=a.calls.find(c=>c.url==='/api/support/conversations');const send=a.calls.find(c=>c.url.endsWith('/messages'));assert.equal(start.method,'POST');assert.match(send.body.body,/balance/i);assert.ok(send.body.idempotency_key.length>=16);assert.equal(a.$('#support-input').value,'');assert.match(a.$('#support-messages').textContent,/Synthetic support answer/);});
  let completeSend;
  await test('Sending prevents duplicate submissions and shows progress',async a=>{await a.click('#support-launcher');a.set('#support-input','What is my balance?');await a.submit();await a.submit();assert.equal(a.calls.filter(c=>c.url.endsWith('/messages')).length,1);assert.equal(a.$('#support-send').disabled,true);assert.equal(a.$('#support-thinking').hidden,false);completeSend({conversation:conversation({version:2}),assistant:{mode:'local'}});await flush();assert.equal(a.$('#support-send').disabled,false);},{conversation:conversation(),handle:(url)=>{if(url.endsWith('/messages'))return new Promise(resolve=>{completeSend=resolve;});}});
  let attempts=0;
  await test('Failed message retains draft and reuses idempotency key on retry',async a=>{await a.click('#support-launcher');a.set('#support-input','What is my balance?');await a.submit();assert.equal(a.$('#support-input').value,'What is my balance?');assert.match(a.$('#support-error').textContent,/Connection lost/);await a.click('[data-support-retry="send"]');const sends=a.calls.filter(c=>c.url.endsWith('/messages'));assert.equal(sends.length,2);assert.equal(sends[0].body.idempotency_key,sends[1].body.idempotency_key);assert.equal(a.$('#support-input').value,'');},{conversation:conversation(),handle:async url=>{if(url.endsWith('/messages')&&attempts++===0)throw new Error('Connection lost');}});
  await test('Explicit handoff keeps a two-way composer and hides quick questions',async a=>{await a.click('#support-launcher');await a.click('#support-handover');assert.match(a.$('#support-status').textContent,/Waiting for admin/);assert.equal(a.$('#support-quick').hidden,true);assert.equal(a.$('#support-chat-form').hidden,false);a.set('#support-input','Additional details for the administrator');await a.submit();assert.match(a.$('#support-messages').textContent,/Additional details/);},{conversation:conversation()});
  await test('Third automated answer switches the conversation to admin queue',async a=>{await a.click('#support-launcher');for(let i=0;i<3;i++)await a.click(`[data-support-question="${i}"]`);assert.match(a.$('#support-status').textContent,/Waiting for admin/);assert.equal(a.$('#support-handover').hidden,true);});
  await test('Chat messages and sender names are escaped plain text',async a=>{await a.click('#support-launcher');assert.match(a.$('#support-messages').textContent,/<img src=x/);assert.equal(a.$$('#support-messages img,#support-messages script').length,0);},{conversation:conversation({messages:[{...message(1,'admin','<img src=x onerror=bad()>'),sender_name:'<script>bad()</script>'}]})});
  await test('Built-in assistant works without provider configuration',async a=>{await a.click('#support-launcher');assert.match(a.$('#support-assistant-label').textContent,/Built-in/);assert.ok(a.calls.every(call=>call.url.startsWith('/api/')));assert.ok(!a.$('#support-panel').textContent.includes('OpenAI'));});
  await test('Polling preserves unsent draft and stops when chat closes or page hides',async a=>{await a.click('#support-launcher');a.set('#support-input','Unsent private draft');await a.tick();assert.equal(a.$('#support-input').value,'Unsent private draft');await a.setHidden(true);assert.equal(a.timers.size,0);await a.setHidden(false);assert.ok(a.timers.size>0);await a.click('#support-close');assert.equal(a.timers.size,0);},{conversation:conversation()});
  let finishRead;
  await test('A response received after logout cannot restore private chat',async a=>{await a.click('#support-launcher');a.session(null);finishRead({conversation:conversation({messages:[message(1,'admin','Private delayed administrator reply')]}),assistant:{mode:'local'}});await flush();assert.ok(!a.$('#support-panel').textContent.includes('Private delayed'));assert.equal(a.$('#support-input').value,'');},{handle:url=>{if(url==='/api/support')return new Promise(resolve=>{finishRead=resolve;});}});
  await test('Escape closes support and returns focus to its opener',async a=>{a.$('#support-launcher').focus();await a.click('#support-launcher');a.$('#support-input').focus();a.$('#support-input').dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(a.$('#support-panel').hidden,true);assert.equal(a.w.document.activeElement.id,'support-launcher');});
  await test('Older message history is prepended in chronological order',async a=>{await a.click('#support-launcher');await a.click('#support-load-older');assert.deepEqual(a.$$('#support-messages article').map(n=>Number(n.dataset.messageId)),[1,2,3]);},{conversation:conversation({messages:[message(3)],has_more:true,before_id:3}),handle:async url=>{if(url==='/api/support/conversations/7?before_id=3')return {conversation:conversation({messages:[message(1),message(2)],has_more:false}),assistant:{mode:'local'}};}});
  await test('Resolved conversation can start a separate new chat',async a=>{await a.click('#support-launcher');assert.equal(a.$('#support-chat-form').hidden,true);await a.click('#support-new');assert.equal(a.$('#support-chat-form').hidden,false);assert.equal(a.calls.find(c=>c.url==='/api/support/conversations').method,'POST');},{conversation:conversation({status:'resolved'})});
  await test('Admin inbox loads only when selected and claims before replying',async a=>{assert.equal(a.calls.length,0);await a.openAdmin();await a.click('[data-support-thread="7"]');assert.equal(a.$('#support-admin-form').hidden,true);await a.click('[data-support-action="claim"]');assert.equal(a.$('#support-admin-form').hidden,false);a.set('#support-admin-input','Synthetic admin response');await a.submit('#support-admin-form');const reply=a.calls.find(c=>c.url.endsWith('/reply'));assert.equal(reply.body.version,5);assert.equal(reply.body.body,'Synthetic admin response');assert.match(a.$('#support-admin-messages').textContent,/Synthetic admin response/);await a.click('[data-support-action="resolve"]');assert.equal(a.$('#support-admin-form').hidden,true);},{admin:true});
  await test('An admin cannot reply in a conversation claimed by another admin',async a=>{await a.openAdmin();await a.click('[data-support-thread="7"]');assert.equal(a.$('#support-admin-form').hidden,true);assert.equal(a.$$('#support-admin-actions button').length,0);assert.match(a.$('#support-admin-assigned').textContent,/another administrator|Assigned to/);},{admin:true,thread:{status:'admin',assigned_admin:{id:3,name:'Other Administrator'}}});
  await test('Silent admin polling preserves reply draft',async a=>{await a.openAdmin();await a.click('[data-support-thread="7"]');a.set('#support-admin-input','Private unsent admin reply');await a.tick();assert.equal(a.$('#support-admin-input').value,'Private unsent admin reply');},{admin:true,thread:{status:'admin',assigned_admin:{id:1,name:'Test Administrator'}}});
  let finishDetail;
  await test('Leaving admin support clears private data and discards delayed details',async a=>{await a.openAdmin();await a.click('[data-support-thread="7"]');a.w.dispatchEvent(new a.w.CustomEvent('edge:admin-tab',{detail:{tab:'events'}}));finishDetail({conversation:conversation({messages:[message(1,'user','Private delayed user message')]})});await flush();assert.ok(!a.$('#support-admin-thread').textContent.includes('Private delayed'));assert.equal(a.$$('#support-inbox-list button').length,0);},{admin:true,handle:url=>{if(url==='/api/admin/support/7')return new Promise(resolve=>{finishDetail=resolve;});}});
  await test('Same-account admin role loss clears inbox and reply draft',async a=>{await a.openAdmin();await a.click('[data-support-thread="7"]');a.set('#support-admin-input','Private admin draft');a.session({id:1,name:'Former Admin',is_admin:false});assert.equal(a.$$('#support-admin-form').length,0);assert.ok(!a.$('#support-admin-thread').textContent.includes(customer.email));},{admin:true,thread:{status:'admin',assigned_admin:{id:1,name:'Test Administrator'}}});
  let finishOldPoll,reads=0;
  await test('An old poll cannot replace a newly started conversation',async a=>{await a.click('#support-launcher');const polling=a.tick();await flush();await a.click('#support-new');assert.equal(a.$('#support-chat-form').hidden,false);finishOldPoll({conversation:conversation({status:'resolved'}),assistant:{mode:'local'}});await polling;assert.equal(a.$('#support-chat-form').hidden,false);assert.equal(a.$('#support-new').hidden,true);},{conversation:conversation({status:'resolved'}),handle:url=>{if(url==='/api/support'&&++reads===2)return new Promise(resolve=>{finishOldPoll=resolve;});}});
  let detailAttempts=0;
  await test('An initially failed admin thread has a working retry action',async a=>{await a.openAdmin();await a.click('[data-support-thread="7"]');assert.match(a.$('#support-admin-error').textContent,/Temporary detail failure/);await a.click('[data-support-retry="thread"]');assert.equal(a.$('#support-admin-customer').textContent,customer.name);},{admin:true,handle:async url=>{if(url==='/api/admin/support/7'&&detailAttempts++===0)throw new Error('Temporary detail failure');}});
  console.log(`${passed} support UI checks passed; ${failed} failed.`);if(failed)process.exitCode=1;
})();
