#!/usr/bin/env node
/* EDGE_JSDOM_PATH=/private/tmp/edge-dom-qa/node_modules/jsdom node scripts/check-kyc-ui.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const jsdomPath = process.env.EDGE_JSDOM_PATH || 'jsdom';
let JSDOM, VirtualConsole, FileList, idl;
try {
  ({JSDOM, VirtualConsole} = require(jsdomPath));
  const library = path.dirname(require.resolve(jsdomPath));
  const generated = fs.existsSync(path.join(library, 'generated/idl/FileList.js')) ? 'generated/idl' : 'jsdom/living/generated';
  FileList = require(path.join(library, generated, 'FileList.js'));
  idl = require(path.join(library, generated, 'utils.js'));
} catch (error) { console.error('Set EDGE_JSDOM_PATH to an external jsdom installation.', error.message); process.exit(1); }
const root = path.resolve(__dirname, '..');
const markup = fs.readFileSync(path.join(root, 'resources/views/partials/kyc.blade.php'), 'utf8');
const adminMarkup = fs.readFileSync(path.join(root, 'resources/views/partials/admin.blade.php'), 'utf8');
const code = fs.readFileSync(path.join(root, 'public/assets/kyc.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
const current = (status = 'not_submitted', changes = {}) => ({status,submission_id:status === 'not_submitted' ? null : 7,version:1,submitted_at:'2026-10-17T12:00:00Z',reviewed_at:null,review_note:null,withdrawal_requires_approval:true,...changes});
const item = (changes = {}) => ({id:7,status:'pending',version:3,user:{id:2,name:'Synthetic Member',email:'member@example.test'},submitted_at:'2026-10-17T12:00:00Z',reviewed_at:null,...changes});
const detail = (changes = {}) => ({...item(),legal_name:'Synthetic Legal Name',date_of_birth:'1990-01-02',country:'US',address:'123 Synthetic Test Street',document_type:'passport',document_number:'SYNTHETIC-DOCUMENT-123',review_note:null,documents:{id_document:{download_url:'/api/kyc/7/documents/id_document',mime_type:'image/png',size:100},selfie:{download_url:'/api/kyc/7/documents/selfie',mime_type:'image/jpeg',size:100}},...changes});

async function setup(options = {}) {
  const errors = [], calls = [], navigations = [], auth = [], vc = new VirtualConsole();
  vc.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(`<!doctype html><body><section id="wallet-page"></section>${adminMarkup}${markup}</body>`, {url:'http://localhost:8135/app',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc});
  const w = dom.window;
  let user = options.user === undefined ? {id:1,name:'Current Member',is_admin:!!options.admin,kyc_status:options.status || 'not_submitted'} : options.user;
  let kyc = current(options.status, options.summary);
  const api = {serverMode:options.serverMode !== false,get user() {return user;},navigate:page => {navigations.push(page);navigate(page);},openAuth:mode => auth.push(mode),request:async (url, opts = {}) => {
    calls.push({url,...opts});
    if (url === '/api/kyc') {
      if (opts.method === 'POST') {
        if (options.onUpload) return options.onUpload(opts);
        kyc = current('pending');return {kyc};
      }
      return options.onCustomerLoad ? options.onCustomerLoad() : {kyc};
    }
    if (url.startsWith('/api/admin/kyc?')) return options.onList ? options.onList(url) : {submissions:options.items || [item()],pagination:options.pagination || {current_page:1,last_page:1,total:1}};
    if (url === '/api/admin/kyc/7') return options.onDetail ? options.onDetail() : {submission:detail(options.detail)};
    if (url === '/api/admin/kyc/7/review') return options.onReview ? options.onReview(JSON.parse(opts.body)) : {submission:detail({status:JSON.parse(opts.body).decision})};
    throw new Error(`Unexpected ${opts.method || 'GET'} ${url}`);
  }};
  w.EdgeAPI = api;
  const $ = selector => {const element = w.document.querySelector(selector);assert.ok(element, `Missing ${selector}`);return element;};
  const $$ = selector => [...w.document.querySelectorAll(selector)];
  $('#admin-workspace').hidden = !options.admin;
  function navigate(page) {$('#verification-page').hidden = page !== 'verification';$('#admin-page').hidden = page !== 'admin';w.dispatchEvent(new w.CustomEvent('edge:navigate',{detail:{page}}));}
  if (options.page === 'verification') $('#verification-page').hidden = false;
  w.eval(code);w.document.dispatchEvent(new w.Event('DOMContentLoaded'));await flush();
  const click = async selector => {$(selector).click();await flush();};
  const input = (name, value, form = '#kyc-submit-form') => {const node = $(`${form} [name="${name}"]`);node.value = value;node.dispatchEvent(new w.Event('input',{bubbles:true}));node.dispatchEvent(new w.Event('change',{bubbles:true}));};
  const file = (name, {size = 64,type = 'image/png',filename = 'synthetic.png'} = {}) => {
    const files = FileList.create(w);
    idl.implForWrapper(files).push(idl.implForWrapper(new w.File([new Uint8Array(size)],filename,{type})));
    $(`#kyc-submit-form [name="${name}"]`).files = files;
    $(`#kyc-submit-form [name="${name}"]`).dispatchEvent(new w.Event('change',{bubbles:true}));
  };
  const complete = () => {
    for (const [name,value] of Object.entries({legal_name:'Synthetic Legal Name',date_of_birth:'1990-01-02',country:'US',address:'123 Synthetic Test Street',document_type:'passport',document_number:'SYNTHETIC-DOCUMENT-123'})) input(name,value);
    file('id_document');file('selfie');$('#kyc-submit-form [name="consent"]').checked = true;
  };
  const submit = async (selector = '#kyc-submit-form') => {$(selector).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await flush();};
  const tab = async (name = 'kyc') => {navigate('admin');$('#admin-kyc-tab').hidden = name !== 'kyc';w.dispatchEvent(new w.CustomEvent('edge:admin-tab',{detail:{tab:name}}));await flush();};
  const session = next => {user = next;w.dispatchEvent(new w.CustomEvent('edge:session',{detail:{serverMode:api.serverMode,user:next}}));};
  const mutations = () => calls.filter(call => call.method === 'POST');
  const decision = async (value = 'approved', note = '') => {
    const radio = $(`#kyc-review-form [name="decision"][value="${value}"]`);radio.checked = true;radio.dispatchEvent(new w.Event('change',{bubbles:true}));
    input('review_note',note,'#kyc-review-form');$('#kyc-review-form [name="confirm_review"]').checked = true;await submit('#kyc-review-form');
  };
  const openReview = async () => {await tab();await click('[data-kyc-review="7"]');};
  return {w,$,$$,calls,errors,auth,navigations,click,input,file,complete,submit,tab,session,navigate,mutations,decision,openReview,close:() => w.close()};
}

let passed = 0, failed = 0;
async function test(name, fn, options) {
  if (process.env.EDGE_CHECK_FILTER && !name.toLowerCase().includes(process.env.EDGE_CHECK_FILTER.toLowerCase())) return;
  let app;
  try {app = await setup(options);await fn(app);assert.deepEqual(app.errors,[],'Runtime errors');console.log(`PASS ${name}`);passed++;}
  catch (error) {console.error(`FAIL ${name}: ${error.message}`);failed++;}
  finally {app?.close();}
}
(async () => {
  await test('Customer identity status loads only when the verification page is opened', async a => {
    assert.equal(a.calls.length,0);a.navigate('verification');await flush();assert.equal(a.calls.length,1);assert.equal(a.calls[0].url,'/api/kyc');assert.ok(a.$('#kyc-submit-form'));
  });
  await test('Guests see sign-in without any identity API request', async a => {
    assert.equal(a.calls.length,0);assert.equal(a.$$('form#kyc-submit-form').length,0);await a.click('[data-kyc-signin]');assert.deepEqual(a.auth,['login']);
  },{user:null,page:'verification'});
  await test('Static preview disables every identity field and never requests identity data', async a => {
    assert.equal(a.$('#kyc-preview-notice').hidden,false);assert.ok(a.$$('#kyc-submit-form input, #kyc-submit-form select, #kyc-submit-form textarea, #kyc-submit-form button').every(node => node.disabled));await a.submit();assert.equal(a.calls.length,0);
  },{serverMode:false,page:'verification'});
  await test('A valid upload sends real FormData and updates to pending only after server confirmation', async a => {
    a.complete();await a.submit();const upload = a.mutations()[0];assert.equal(upload.url,'/api/kyc');assert.ok(upload.body instanceof a.w.FormData);assert.equal(upload.body.get('country'),'US');assert.equal(upload.body.get('id_document').name,'synthetic.png');assert.equal(upload.body.get('selfie').size,64);assert.equal(upload.headers,undefined);assert.match(a.$('#kyc-status').textContent,/Pending review/);assert.equal(a.$$('form#kyc-submit-form').length,0);
  },{page:'verification'});
  let finishUpload;
  await test('Uploading disables the complete form and prevents duplicate requests', async a => {
    a.complete();await a.submit();assert.equal(a.mutations().length,1);assert.equal(a.$('[data-kyc-submit]').disabled,true);assert.equal(a.$('.kyc-form-card').getAttribute('aria-busy'),'true');assert.match(a.$('[data-kyc-submit]').textContent,/Submitting/);await a.submit();assert.equal(a.mutations().length,1);finishUpload({kyc:current('pending')});await flush();assert.match(a.$('#kyc-status').textContent,/Pending review/);
  },{page:'verification',onUpload:() => new Promise(resolve => {finishUpload = resolve;})});
  await test('Unsupported selfie files are rejected before uploading', async a => {
    a.complete();a.file('selfie',{type:'application/pdf',filename:'synthetic.pdf'});await a.submit();assert.equal(a.mutations().length,0);assert.match(a.$('[data-kyc-file-feedback="selfie"]').textContent,/JPG or PNG/);
  },{page:'verification'});
  await test('The 2 MB upload limit is enforced with a useful inline message', async a => {
    a.complete();a.file('id_document',{size:2 * 1024 * 1024 + 1});await a.submit();assert.equal(a.mutations().length,0);assert.match(a.$('[data-kyc-file-feedback="id_document"]').textContent,/up to 2 MB/);
  },{page:'verification'});
  await test('Consent is required before private documents can be submitted', async a => {
    a.complete();a.$('[name="consent"]').checked = false;await a.submit();assert.equal(a.mutations().length,0);assert.equal(a.$('[name="consent"]').required,true);
  },{page:'verification'});
  await test('Server validation errors restore the form and remain plain text', async a => {
    a.complete();await a.submit();assert.equal(a.$('[data-kyc-submit]').disabled,false);assert.match(a.$('#kyc-submit-error').textContent,/<img/);assert.equal(a.$$('#kyc-submit-error img').length,0);
  },{page:'verification',onUpload:async () => {throw Object.assign(new Error('Invalid upload'),{errors:{id_document:['<img src=x onerror=bad()> needs replacing']}});}});
  await test('Pending customers see authenticated download links and a status refresh action', async a => {
    assert.equal(a.$$('form#kyc-submit-form').length,0);assert.equal(a.$('a[download]').getAttribute('href'),'/api/kyc/7/documents/id_document');await a.click('[data-kyc-refresh]');assert.equal(a.calls.filter(call => call.url === '/api/kyc').length,2);
  },{page:'verification',status:'pending'});
  await test('Approved identity clearly unlocks the withdrawal path', async a => {
    assert.match(a.$('#kyc-status').textContent,/Verified/);assert.match(a.$('#kyc-wallet-notice').textContent,/approved for withdrawal/);await a.click('[data-kyc-wallet]');assert.deepEqual(a.navigations,['wallet']);
  },{page:'verification',status:'approved'});
  await test('Rejected reasons are escaped and resubmission starts with empty private fields', async a => {
    assert.match(a.$('.kyc-status-note').textContent,/<img/);assert.equal(a.$$('.kyc-status-note img').length,0);await a.click('[data-kyc-resubmit]');assert.equal(a.$('[name="legal_name"]').value,'');assert.equal(a.$('[name="id_document"]').files.length,0);
  },{page:'verification',status:'rejected',summary:{review_note:'<img src=x onerror=bad()> Please submit clearer pictures.'}});
  await test('Leaving verification removes unsaved identity details and selected files', async a => {
    a.complete();a.navigate('wallet');assert.equal(a.$('[name="legal_name"]').value,'');assert.equal(a.$('[name="id_document"]').files.length,0);assert.doesNotMatch(a.$('#kyc-customer-content').innerHTML,/SYNTHETIC-DOCUMENT-123/);
  },{page:'verification'});
  await test('Logout removes private input fields and wallet verification information', async a => {
    a.complete();a.session(null);assert.equal(a.$$('form#kyc-submit-form').length,0);assert.equal(a.$$('#kyc-wallet-notice').length,0);assert.match(a.$('#kyc-customer-content').textContent,/Sign in/);
  },{page:'verification'});
  let staleUpload;
  await test('An upload response after logout cannot restore private account state', async a => {
    a.complete();await a.submit();a.session(null);staleUpload({kyc:current('pending')});await flush();assert.match(a.$('#kyc-customer-content').textContent,/Sign in/);assert.equal(a.$$('#kyc-status').length,0);
  },{page:'verification',onUpload:() => new Promise(resolve => {staleUpload = resolve;})});
  let staleStatus;
  await test('An identity status response after logout is discarded', async a => {
    a.session(null);staleStatus({kyc:current('rejected',{review_note:'PRIVATE-REVIEW-NOTE'})});await flush();assert.doesNotMatch(a.$('#kyc-customer-content').textContent,/PRIVATE-REVIEW-NOTE/);assert.match(a.$('#kyc-customer-content').textContent,/Sign in/);
  },{page:'verification',onCustomerLoad:() => new Promise(resolve => {staleStatus = resolve;})});
  await test('Non-administrators cannot fetch the identity review queue', async a => {
    await a.tab();assert.equal(a.calls.length,0);assert.equal(a.$('#kyc-review-list').innerHTML,'');
  });
  await test('The administrator queue loads on selection and escapes account names', async a => {
    assert.equal(a.calls.length,0);await a.tab();assert.equal(a.calls[0].url,'/api/admin/kyc?status=pending&page=1');assert.equal(a.$$('#kyc-review-list img').length,0);assert.match(a.$('#kyc-review-list').textContent,/<img/);
  },{admin:true,items:[item({user:{id:2,name:'<img src=x onerror=bad()>',email:'member@example.test'}})]});
  await test('Review details escape identity fields and use authenticated same-origin document links', async a => {
    await a.openReview();assert.match(a.$('#kyc-review-content').textContent,/<script/);assert.equal(a.$$('#kyc-review-content script').length,0);assert.equal(a.$$('.kyc-review-documents a').length,1);assert.equal(a.$('.kyc-review-documents a').getAttribute('href'),'/api/kyc/7/documents/selfie');
  },{admin:true,detail:{legal_name:'<script>bad()</script>',documents:{id_document:{download_url:'https://evil.example.test/api/kyc/7/documents/id_document',mime_type:'image/png',size:100},selfie:{download_url:'/api/kyc/7/documents/selfie',mime_type:'image/jpeg',size:100}}}});
  await test('Approving requires an explicit review confirmation then sends the version and decision', async a => {
    await a.openReview();await a.decision();assert.equal(a.mutations().length,0);assert.equal(a.$('#kyc-review-confirmation').hidden,false);assert.match(a.$('#kyc-review-confirmation').textContent,/eligible to request withdrawals/);await a.click('#kyc-decision-confirm');const body = JSON.parse(a.mutations()[0].body);assert.deepEqual(body,{version:3,decision:'approved',review_note:''});assert.equal(a.$('#kyc-review-dialog').hidden,true);assert.equal(a.$('#kyc-review-content').innerHTML,'');
  },{admin:true});
  await test('Rejection requires a clear note before confirmation', async a => {
    await a.openReview();await a.decision('rejected','Too short');assert.equal(a.$('#kyc-review-confirmation').hidden,true);assert.equal(a.$('#kyc-review-form [name="review_note"]').required,true);assert.equal(a.mutations().length,0);await a.decision('rejected','Please upload a readable identity document.');await a.click('#kyc-decision-confirm');assert.equal(JSON.parse(a.mutations()[0].body).review_note,'Please upload a readable identity document.');
  },{admin:true});
  let finishReview;
  await test('Saving a review shows progress and prevents duplicate decisions', async a => {
    await a.openReview();await a.decision();await a.click('#kyc-decision-confirm');assert.equal(a.$('#kyc-decision-confirm').disabled,true);assert.match(a.$('#kyc-decision-confirm').textContent,/Saving/);await a.click('#kyc-decision-confirm');assert.equal(a.mutations().length,1);finishReview({submission:detail({status:'approved'})});await flush();assert.equal(a.$('#kyc-review-dialog').hidden,true);
  },{admin:true,onReview:() => new Promise(resolve => {finishReview = resolve;})});
  await test('A stale review explains the conflict and does not display an approved status', async a => {
    await a.openReview();await a.decision();await a.click('#kyc-decision-confirm');assert.match(a.$('#kyc-review-error').textContent,/Refresh/);assert.equal(a.$('#kyc-review-dialog').hidden,false);assert.equal(a.$('#kyc-decision-confirm').disabled,false);assert.match(a.$('#kyc-review-list').textContent,/Pending review/);
  },{admin:true,onReview:async () => {throw Object.assign(new Error('Verification changed. Refresh it before reviewing.'),{status:409});}});
  await test('Closing a review removes decrypted details from the document', async a => {
    await a.openReview();assert.match(a.$('#kyc-review-content').textContent,/SYNTHETIC-DOCUMENT-123/);await a.click('#kyc-review-dialog [data-kyc-close]');assert.equal(a.$('#kyc-review-dialog').hidden,true);assert.equal(a.$('#kyc-review-content').innerHTML,'');
  },{admin:true});
  await test('Changing administrator tabs clears open private details', async a => {
    await a.openReview();await a.tab('events');assert.equal(a.$('#kyc-review-dialog').hidden,true);assert.equal(a.$('#kyc-review-content').innerHTML,'');assert.equal(a.$('#kyc-review-list').innerHTML,'');
  },{admin:true});
  await test('Administrators cannot approve their own identity submission', async a => {
    await a.openReview();assert.match(a.$('#kyc-review-content').textContent,/cannot review your own/);assert.equal(a.$$('form#kyc-review-form').length,0);assert.equal(a.mutations().length,0);
  },{admin:true,detail:{user:{id:1,name:'Current Administrator',email:'admin@example.test'}}});
  let staleDetail;
  await test('Private detail responses received after logout never render', async a => {
    await a.openReview();a.session(null);staleDetail({submission:detail()});await flush();assert.equal(a.$('#kyc-review-content').innerHTML,'');assert.equal(a.$('#kyc-review-dialog').hidden,true);
  },{admin:true,onDetail:() => new Promise(resolve => {staleDetail = resolve;})});
  let staleList;
  await test('Review queue responses received after leaving the admin page are discarded', async a => {
    await a.tab();a.navigate('wallet');staleList({submissions:[item()],pagination:{current_page:1,last_page:1,total:1}});await flush();assert.equal(a.$('#kyc-review-list').innerHTML,'');
  },{admin:true,onList:() => new Promise(resolve => {staleList = resolve;})});
  await test('Escape closes the review and returns focus to its queue button', async a => {
    await a.openReview();a.w.document.dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.equal(a.$('#kyc-review-dialog').hidden,true);assert.equal(a.w.document.activeElement,a.$('[data-kyc-review="7"]'));
  },{admin:true});
  await test('Losing administrator access immediately clears decrypted identity details', async a => {
    await a.openReview();a.w.dispatchEvent(new a.w.CustomEvent('edge:account-state',{detail:{user:{id:1,is_admin:false,kyc_status:'not_submitted'}}}));await flush();assert.equal(a.$('#kyc-review-content').innerHTML,'');assert.equal(a.$('#kyc-review-list').innerHTML,'');assert.equal(a.$('#kyc-review-dialog').hidden,true);
  },{admin:true});
  let statusLoads = 0;
  await test('A changed account status automatically refreshes the visible verification result', async a => {
    assert.match(a.$('#kyc-status').textContent,/Pending review/);a.w.dispatchEvent(new a.w.CustomEvent('edge:account-state',{detail:{user:{id:1,is_admin:false,kyc_status:'approved'}}}));await flush();assert.equal(a.calls.filter(call => call.url === '/api/kyc').length,2);assert.match(a.$('#kyc-status').textContent,/Verified/);
  },{page:'verification',status:'pending',onCustomerLoad:async () => ({kyc:current(statusLoads++ === 0 ? 'pending' : 'approved')})});
  await test('An unchanged account poll preserves unsent identity details and files', async a => {
    a.complete();a.w.dispatchEvent(new a.w.CustomEvent('edge:account-state',{detail:{user:{id:1,is_admin:false,kyc_status:'not_submitted'}}}));await flush();assert.equal(a.$('[name="document_number"]').value,'SYNTHETIC-DOCUMENT-123');assert.equal(a.$('[name="id_document"]').files.length,1);assert.equal(a.calls.filter(call => call.url === '/api/kyc').length,1);
  },{page:'verification'});
  console.log(`\n${passed} KYC UI checks passed; ${failed} failed.`);process.exitCode = failed ? 1 : 0;
})();
