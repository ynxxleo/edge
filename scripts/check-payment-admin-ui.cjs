#!/usr/bin/env node
/* EDGE_JSDOM_PATH=/private/tmp/edge-dom-qa/node_modules/jsdom node scripts/check-payment-admin-ui.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let JSDOM, VirtualConsole;
try { ({JSDOM, VirtualConsole} = require(process.env.EDGE_JSDOM_PATH || 'jsdom')); }
catch { console.error('Set EDGE_JSDOM_PATH to an external jsdom installation.'); process.exit(1); }
const root = path.resolve(__dirname, '..');
const markup = fs.readFileSync(path.join(root, 'resources/views/partials/admin.blade.php'), 'utf8');
const code = fs.readFileSync(path.join(root, 'public/assets/admin.js'), 'utf8');
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); };
const fixture = () => ({version:7,stripe_enabled:false,stripe_mode:'test',stripe_publishable_key:'pk_test_ui_fixture',stripe_secret_key_configured:true,stripe_webhook_secret_configured:true,manual_enabled:true,manual_bank_name:'Fixture Bank',manual_account_name:'EDGE Fixture',manual_account_number:'0012345678',manual_reference_label:'Your transfer reference',manual_instructions:'Use your own transfer reference.',manual_support_contact:'support@example.test'});
async function setup(options = {}) {
  const calls = [], errors = [], vc = new VirtualConsole();
  vc.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(`<!doctype html><body>${markup}</body>`, {runScripts:'outside-only',url:'http://localhost:8135/admin',virtualConsole:vc});
  const w = dom.window;
  let settings = {...fixture(), ...options.settings};
  if (options.serverMode !== false) w.EdgeAPI = {serverMode:true,user:options.user === undefined ? {id:1,is_admin:true} : options.user,request:async (url, opts = {}) => {
    calls.push({url,...opts});
    if (url === '/api/admin/payment-settings') {
      if (opts.method === 'PATCH') {
        if (options.onSave) return options.onSave(JSON.parse(opts.body));
        const body = JSON.parse(opts.body);
        delete body.current_password;delete body.stripe_secret_key;delete body.stripe_webhook_secret;
        settings = {...settings,...body,version:settings.version+1};
        return {settings};
      }
      if (options.onLoad) return options.onLoad();
      return {settings};
    }
    return url === '/api/admin/overview' ? {counts:{},recent_audits:[]} : {};
  }};
  w.eval(code);w.document.dispatchEvent(new w.Event('DOMContentLoaded'));await flush();
  const $ = selector => {const element = w.document.querySelector(selector);assert.ok(element, `Missing ${selector}`);return element;};
  const $$ = selector => [...w.document.querySelectorAll(selector)];
  const click = selector => $(selector).click();
  const input = (name,value) => {const element = $(`#admin-payment-settings-form [name="${name}"]`);element.value = value;element.dispatchEvent(new w.Event('change',{bubbles:true}));};
  const open = async () => {click('[data-admin-tab="settings"]');await flush();click('[data-admin-edit-settings]');await flush();};
  const submit = async () => {$('#admin-payment-settings-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await flush();};
  const mutations = () => calls.filter(call => call.method === 'PATCH');
  const session = user => w.dispatchEvent(new w.CustomEvent('edge:session',{detail:{serverMode:true,user}}));
  return {w,$,$$,calls,errors,click,input,open,submit,mutations,session,close:() => w.close()};
}
let passed = 0, failed = 0;
async function test(name,fn,options) {
  let app;
  try {app = await setup(options);await fn(app);assert.deepEqual(app.errors, []);console.log(`PASS ${name}`);passed++;}
  catch (error) {console.error(`FAIL ${name}: ${error.message}`);failed++;}
  finally {app?.close();}
}
(async () => {
  await test('Payment settings are fetched only after the settings tab opens', async a => {
    assert.equal(a.calls.length,5);assert.equal(a.calls.filter(call => call.url.includes('payment-settings')).length,0);
    a.click('[data-admin-tab=settings]');await flush();
    assert.equal(a.calls.filter(call => call.url === '/api/admin/payment-settings').length,1);
    assert.equal(a.$('#admin-settings-tab').hidden,false);
    assert.match(a.$('#admin-payment-settings').textContent,/SANDBOX \/ TEST/);
    assert.match(a.$('#admin-payment-settings').textContent,/http:\/\/localhost:8135\/api\/payments\/stripe\/webhook/);
  });
  await test('Stored secrets never populate the form or render in the settings page', async a => {
    await a.open();
    assert.equal(a.$('[name=stripe_secret_key]').value,'');assert.equal(a.$('[name=stripe_webhook_secret]').value,'');
    assert.equal(a.$('[name=current_password]').value,'');
    assert.match(a.$('#admin-modal-content').textContent,/A secret is saved/);
    assert.ok(!a.w.document.body.innerHTML.includes('secret-from-server'));
    assert.ok(!a.w.document.body.innerHTML.includes('webhook-from-server'));
  }, {settings:{stripe_secret_key:'secret-from-server',stripe_webhook_secret:'webhook-from-server'}});
  await test('Every settings update requires the administrator current password', async a => {
    await a.open();await a.submit();assert.equal(a.mutations().length,0);
    assert.match(a.$('#admin-modal-error').textContent,/current password/);
    assert.equal(a.$('[name=current_password]').required,true);
    assert.equal(a.$('[name=current_password]').autocomplete,'current-password');
    assert.equal(a.$('[name=current_password]').type,'password');
  });
  await test('Saving ordinary details preserves blank secrets and sends optimistic version', async a => {
    await a.open();a.input('current_password','fixture-password');a.input('manual_bank_name','Updated Bank');
    await a.submit();const body = JSON.parse(a.mutations()[0].body);
    assert.equal(body.version,7);assert.equal(body.current_password,'fixture-password');
    assert.equal(body.manual_bank_name,'Updated Bank');assert.equal(body.manual_account_number,'0012345678');
    assert.equal('stripe_secret_key' in body,false);assert.equal('stripe_webhook_secret' in body,false);
    assert.equal(a.$('#admin-modal').hidden,true);assert.match(a.$('#admin-payment-settings').textContent,/Updated Bank/);
  });
  await test('New secrets are write-only password inputs and cleared after a successful save', async a => {
    await a.open();
    const form = a.$('#admin-payment-settings-form');
    assert.equal(form.elements.stripe_secret_key.type,'password');assert.equal(form.elements.stripe_secret_key.autocomplete,'new-password');
    assert.equal(form.elements.stripe_webhook_secret.type,'password');assert.equal(form.elements.stripe_webhook_secret.autocomplete,'new-password');
    a.input('stripe_secret_key','fixture-new-secret');a.input('stripe_webhook_secret','fixture-new-webhook');a.input('current_password','fixture-password');
    await a.submit();const body = JSON.parse(a.mutations()[0].body);
    assert.equal(body.stripe_secret_key,'fixture-new-secret');assert.equal(body.stripe_webhook_secret,'fixture-new-webhook');
    assert.equal(form.elements.stripe_secret_key.value,'');assert.equal(form.elements.stripe_webhook_secret.value,'');assert.equal(form.elements.current_password.value,'');
    a.click('[data-admin-edit-settings]');assert.equal(a.$('[name=stripe_secret_key]').value,'');assert.equal(a.$('#admin-payment-settings-form').dataset.version,'8');
  });
  await test('Mode badges reflect sandbox and live selections and the saved mode', async a => {
    await a.open();a.input('stripe_mode','live');assert.equal(a.$('#admin-stripe-mode-label').textContent,'LIVE MODE');
    a.input('current_password','fixture-password');await a.submit();
    assert.match(a.$('#admin-payment-settings').textContent,/LIVE MODE/);assert.equal(JSON.parse(a.mutations()[0].body).stripe_mode,'live');
  });
  await test('Manual deposit toggle and separate bank credentials are editable', async a => {
    await a.open();assert.match(a.$('#admin-payment-settings-form').textContent,/Enable manual deposits/);
    a.$('[name=manual_enabled]').checked=false;a.input('manual_account_name','New Account Owner');a.input('manual_support_contact','payments@example.test');a.input('current_password','fixture-password');await a.submit();
    const body=JSON.parse(a.mutations()[0].body);assert.equal(body.manual_enabled,false);assert.equal(body.manual_account_name,'New Account Owner');assert.equal(body.manual_support_contact,'payments@example.test');
  });
  await test('Validation errors do not echo submitted secret values and clear transient credentials', async a => {
    await a.open();a.input('stripe_secret_key','new-sensitive-value');a.input('current_password','fixture-password');await a.submit();
    assert.match(a.$('#admin-modal-error').textContent,/Check the secret key/);
    assert.ok(!a.$('#admin-modal-error').textContent.includes('new-sensitive-value'));
    assert.equal(a.$('[name=stripe_secret_key]').value,'');assert.equal(a.$('[name=current_password]').value,'');
    assert.equal(a.$('#admin-payment-settings-form button[type=submit]').disabled,false);
  },{onSave:async () => {throw Object.assign(new Error('Provider rejected new-sensitive-value'),{errors:{stripe_secret_key:['Invalid new-sensitive-value']}});}});
  await test('Unknown provider errors are replaced with a safe actionable message', async a => {
    await a.open();a.input('current_password','fixture-password');await a.submit();
    assert.match(a.$('#admin-modal-error').textContent,/could not be saved/);assert.ok(!a.$('#admin-modal-error').textContent.includes('upstream-sensitive-key'));
  },{onSave:async () => {throw new Error('upstream-sensitive-key');}});
  await test('Version conflicts explain how to refresh without disclosing response text', async a => {
    await a.open();a.input('current_password','fixture-password');await a.submit();
    assert.match(a.$('#admin-modal-error').textContent,/Settings changed in another session/);assert.match(a.$('#admin-modal-error').textContent,/refresh/);
    assert.ok(!a.$('#admin-modal-error').textContent.includes('server-sensitive-context'));
  },{onSave:async () => {throw Object.assign(new Error('server-sensitive-context'),{status:409});}});
  await test('Closing the settings modal clears password and both secret fields', async a => {
    await a.open();const form=a.$('#admin-payment-settings-form');
    a.input('current_password','fixture-password');a.input('stripe_secret_key','fixture-key');a.input('stripe_webhook_secret','fixture-webhook');
    a.click('[data-admin-close]');assert.equal(a.$('#admin-modal').hidden,true);
    for (const key of ['current_password','stripe_secret_key','stripe_webhook_secret']) assert.equal(form.elements[key].value,'');
    assert.equal(a.mutations().length,0);
  });
  await test('Leaving the settings tab clears unsaved credentials', async a => {
    await a.open();const form=a.$('#admin-payment-settings-form');a.input('current_password','fixture-password');a.input('stripe_secret_key','fixture-key');
    a.click('[data-admin-tab=events]');assert.equal(a.$('#admin-modal').hidden,true);assert.equal(form.elements.current_password.value,'');assert.equal(form.elements.stripe_secret_key.value,'');
  });
  await test('Logging out clears settings and unsaved credentials from the workspace', async a => {
    await a.open();const form=a.$('#admin-payment-settings-form');a.input('current_password','fixture-password');a.input('stripe_secret_key','fixture-key');a.session(null);
    assert.equal(a.$('#admin-workspace').hidden,true);assert.equal(a.$('#admin-modal').hidden,true);assert.equal(a.$('#admin-payment-settings').innerHTML,'');
    assert.equal(form.elements.current_password.value,'');assert.equal(form.elements.stripe_secret_key.value,'');
  });
  await test('Non-admin accounts cannot request payment settings or save credentials', async a => {
    a.click('[data-admin-tab=settings]');await flush();assert.equal(a.calls.length,0);assert.equal(a.$('#admin-workspace').hidden,true);assert.equal(a.$('[data-admin-edit-settings]').disabled,true);
  },{user:{id:2,is_admin:false}});
  await test('Static preview contains fictional payment data and disables every settings save', async a => {
    await a.open();assert.match(a.$('#admin-payment-settings').textContent,/Example Bank/);
    assert.equal(a.$('#admin-payment-settings-form button[type=submit]').disabled,true);
    assert.equal(a.$('[name=stripe_secret_key]').value,'');assert.equal(a.$('[name=stripe_publishable_key]').value,'');
    await a.submit();assert.equal(a.calls.length,0);assert.match(a.$('#admin-modal-error').textContent,/Read-only preview/);
  },{serverMode:false});
  let loads=0;
  await test('Settings load failures show a retry action without exposing provider details', async a => {
    a.click('[data-admin-tab=settings]');await flush();assert.match(a.$('#admin-payment-settings').textContent,/could not be loaded/);
    assert.ok(!a.$('#admin-payment-settings').textContent.includes('private-provider-detail'));assert.equal(a.$('[data-admin-edit-settings]').disabled,true);
    a.click('[data-admin-retry-settings]');await flush();assert.match(a.$('#admin-payment-settings').textContent,/Fixture Bank/);assert.equal(a.$('[data-admin-edit-settings]').disabled,false);
  },{onLoad:async () => {if (loads++===0) throw new Error('private-provider-detail');return {settings:fixture()};}});
  let resolveLoad;
  await test('A settings response arriving after logout is discarded', async a => {
    a.click('[data-admin-tab=settings]');await flush();a.session(null);resolveLoad({settings:fixture()});await flush();
    assert.equal(a.$('#admin-payment-settings').innerHTML,'');assert.equal(a.$('#admin-workspace').hidden,true);
  },{onLoad:() => new Promise(resolve => {resolveLoad=resolve;})});
  let resolveSave;
  await test('A save response arriving after logout cannot restore admin settings', async a => {
    await a.open();a.input('current_password','fixture-password');a.$('#admin-payment-settings-form').dispatchEvent(new a.w.Event('submit',{bubbles:true,cancelable:true}));await flush();
    a.session(null);resolveSave({settings:{...fixture(),version:8}});await flush();
    assert.equal(a.$('#admin-payment-settings').innerHTML,'');assert.equal(a.$('#admin-workspace').hidden,true);assert.equal(a.$('#admin-modal').hidden,true);
  },{onSave:() => new Promise(resolve => {resolveSave=resolve;})});
  await test('Saved bank details and instructions render as text without HTML injection', async a => {
    await a.open();assert.equal(a.$$('#admin-payment-settings img').length,0);assert.equal(a.$$('#admin-modal-content script').length,0);
    assert.match(a.$('#admin-payment-settings').textContent,/<img/);assert.equal(a.$('[name=manual_instructions]').value,'<script>unsafe()</script>');
  },{settings:{manual_bank_name:'<img src=x onerror=unsafe()>',manual_instructions:'<script>unsafe()</script>'}});
  let refreshVersion=7;
  await test('Refresh fetches the current settings version before the next edit', async a => {
    await a.open();assert.equal(a.$('#admin-payment-settings-form').dataset.version,'7');a.click('[data-admin-close]');
    a.click('#admin-refresh');await flush();a.click('[data-admin-edit-settings]');assert.equal(a.$('#admin-payment-settings-form').dataset.version,'8');
  },{onLoad:async () => ({settings:{...fixture(),version:refreshVersion++}})});
  let finishSave;
  await test('Repeated submission while a save is pending sends only one update', async a => {
    await a.open();a.input('current_password','fixture-password');
    await a.submit();await a.submit();assert.equal(a.mutations().length,1);assert.equal(a.$('#admin-payment-settings-form button[type=submit]').disabled,true);
    finishSave({settings:{...fixture(),version:8}});await flush();assert.equal(a.$('#admin-modal').hidden,true);
  },{onSave:() => new Promise(resolve => {finishSave=resolve;})});
  console.log(`\n${passed} payment admin UI checks passed; ${failed} failed.`);process.exitCode=failed?1:0;
})();
