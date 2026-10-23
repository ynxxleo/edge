#!/usr/bin/env node
/* API-backed UI checks with a deterministic mock of the real JSON contracts.
   EDGE_JSDOM_PATH=/private/tmp/edge-dom-qa/node_modules/jsdom node scripts/check-server-ui.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require(process.env.EDGE_JSDOM_PATH || 'jsdom')); }
catch { console.error('Install jsdom outside the repository and set EDGE_JSDOM_PATH.'); process.exit(1); }
const root = path.resolve(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));
const member = { id: 1, name: 'Test Member', email: 'member@test.invalid', is_admin: false, kyc_status: 'approved', account_number:'1234567890' };
const strategy = { id: 11, name: 'Touchline Method', slug: 'touchline', sport: 'football', description: 'Copies administrator picks.', risk: 'balanced', stake_percentage: 10, active: true, min_deposit_cents: 10000 };
const future = new Date(Date.now() + 86400000).toISOString();
const past = new Date(Date.now() - 86400000).toISOString();
const event = (id, status = 'open', changes = {}) => ({ id, sport: 'football', league: 'API League', country: 'Test', home_name: `Server Home ${id}`, away_name: `Server Away ${id}`, starts_at: status === 'open' ? future : past, status, odds_home: '1.1100', odds_draw: '3.2000', odds_away: '2.5000', home_score: null, away_score: null, version: 7, ...changes });
const initialState = () => ({ user: clone(member), currency: 'USD', balance_cents: 100000, profit_cents: 0, active_stakes_cents: 0, potential_returns_cents: 0, bets: [], transactions: [], copy_positions: [], wallet_requests: [] });
const tick = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };
let passed = 0, failed = 0;

async function setup(options = {}) {
  const errors = [], calls = [], intervals = [], queuedFailures = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', error => errors.push(error.message));
  let html = fs.readFileSync(path.join(root, 'resources/views/app.blade.php'), 'utf8')
    .replace("{{ $serverMode ?? 'static' }}", 'laravel')
    .replace("@include('partials.admin')", fs.readFileSync(path.join(root, 'resources/views/partials/admin.blade.php'), 'utf8'))
    .replace("@include('partials.kyc')", fs.readFileSync(path.join(root, 'resources/views/partials/kyc.blade.php'), 'utf8'));
  const dom = new JSDOM(html, { url: 'http://localhost:8000/' + (options.hash || ''), runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  const backend = {
    user: options.guest ? null : { ...member, is_admin: !!options.admin },
    state: Object.assign(initialState(), options.state || {}),
    events: clone(options.events || [event(101), event(102), event(103, 'live'), event(104, 'finished', { home_score: 2, away_score: 0 })]),
    token: 'csrf-initial',
    methods: clone(options.methods || { stripe: { enabled: false, mode: 'test' }, manual: { enabled: true, instructions: 'Use only verified payment instructions.', reference_label: 'Funding reference' } }),
  };
  backend.state.user = backend.user;
  w.scrollTo = () => {};
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.setInterval = callback => { intervals.push(callback); return intervals.length; };
  const saved = JSON.stringify({ balance: 999999999, profit: 999999999, bets: [], transactions: [], copyPositions: [] });
  w.localStorage.setItem('edge-demo-v1', saved);
  w.fetch = async (url, opts = {}) => {
    const call = { path: url, method: opts.method || 'GET', headers: clone(opts.headers || {}), credentials: opts.credentials, body: opts.body instanceof w.FormData ? opts.body : opts.body ? JSON.parse(opts.body) : null };
    calls.push(call);
    const fail = queuedFailures.findIndex(f => f.path === url);
    if (fail !== -1) {
      const f = queuedFailures.splice(fail, 1)[0];
      if (f.status === null) throw new Error('Network connection lost.');
      return { ok: false, status: f.status, json: async () => clone(f.data) };
    }
    let data;
    if (url === '/api/session') data = { user: backend.user, csrf_token: backend.token, currency: 'USD', payment_mode: 'manual_review', deposit_instructions: 'Use only verified payment instructions.' };
    else if (url.startsWith('/api/wallet/transfers?page=')) data={account_number:backend.user?.account_number,transfers:backend.transfers||[],pagination:{current_page:1,last_page:1,total:(backend.transfers||[]).length}};
    else if (url==='/api/wallet/transfers/recipient') data={recipient:{name:'Recipient P.',account_number:call.body.account_number},confirmation_token:'test-confirmation'};
    else if (url==='/api/wallet/transfers'){backend.state.balance_cents-=call.body.amount_cents;const transfer={reference:'internal-transfer-test',direction:'sent',amount_cents:call.body.amount_cents,counterparty:{name:'Recipient P.',account_number:call.body.account_number},created_at:future,status:'completed'};backend.transfers=[transfer];data={transfer};}
    else if (url === '/api/payment-methods') data = backend.methods;
    else if (url === '/api/kyc') data = {kyc:{status:(opts.method || 'GET') === 'POST'?'pending':backend.user?.kyc_status || 'not_submitted'}};
    else if (url === '/api/payments/stripe/checkout') data = { checkout_url: options.checkoutUrl || 'https://checkout.stripe.com/c/pay/cs_test_example', reference: 'stripe-test-reference', session_id: 'cs_test_example', mode: 'test', ...(options.checkoutPaid ? {payment:{status:'paid'},checkout_url:null}: {}) };
    else if (url === '/api/events') data = { events: backend.events };
    else if (url === '/api/copy/strategies') data = { strategies: [strategy] };
    else if (url === '/api/state') data = { ...backend.state, user: backend.user };
    else if (url === '/api/auth/login' || url === '/api/auth/register') {
      backend.pending = { ...member, name: call.body.name || member.name, email: call.body.email, is_admin: !!options.loginAdmin };
      data = {requires_otp:true,email_hint:'m***@test.invalid',resend_after:60};
    } else if (url === '/api/auth/resend') {
      data = {requires_otp:true,email_hint:'m***@test.invalid',resend_after:60};
    } else if (url === '/api/auth/verify') {
      backend.user = backend.pending;
      backend.state.user = backend.user;
      backend.token = 'csrf-auth-rotated';
      data = { user: backend.user, csrf_token: backend.token, currency: 'USD' };
    } else if (url === '/api/auth/logout') {
      backend.user = null; backend.token = 'csrf-logout-rotated';
      data = { user: null, csrf_token: backend.token, currency: 'USD' };
    } else if (url === '/api/bets') {
      backend.state.balance_cents -= call.body.stake_cents;
      const bet = { id: backend.state.bets.length + 1, reference: 'server-bet-reference', type: call.body.type, stake_cents: call.body.stake_cents, payout_cents: 0, potential_return_cents: 1233, status: 'pending', created_at: future, selections: call.body.selections.map(s => ({ ...s, home_name: 'Server Home', away_name: 'Server Away', odds: s.expected_odds, status: 'pending' })) };
      backend.state.bets.unshift(bet); data = { bet };
    } else if (url === '/api/wallet/requests') {
      const request = { id: backend.state.wallet_requests.length + 1, reference: 'server-payment-request', status: 'pending', created_at: future, ...call.body };
      backend.state.wallet_requests.unshift(request);
      if (call.body.type === 'withdrawal') backend.state.balance_cents -= call.body.amount_cents;
      data = { request };
    } else if (url === '/api/copy/positions') {
      if (call.body.amount_cents > backend.state.balance_cents) return { ok: false, status: 422, json: async () => ({ message: 'Validation failed.', errors: { amount_cents: ['Your available wallet balance is too low.'] } }) };
      backend.state.balance_cents -= call.body.amount_cents;
      const position = { id: 1, strategy_id: strategy.id, strategy, principal_cents: call.body.amount_cents, value_cents: call.body.amount_cents, equity_cents: call.body.amount_cents, reserved_cents: 0, profit_cents: 0, status: 'active', stake_percentage: 10, stakes: [], created_at: future };
      backend.state.copy_positions.unshift(position); data = { position };
    } else throw new Error(`Unexpected mock API request: ${call.method} ${url}`);
    return { ok: true, status: 200, json: async () => clone(data) };
  };
  w.addEventListener('error', e => errors.push(e.error?.message || e.message));
  w.eval(fs.readFileSync(path.join(root, 'public/assets/app.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(root, 'public/assets/server-app.js'), 'utf8'));
  if(options.transfers)w.eval(fs.readFileSync(path.join(root,'public/assets/transfers.js'),'utf8'));
  await tick();
  const $ = selector => { const element = w.document.querySelector(selector); assert.ok(element, `Missing ${selector}`); return element; };
  const $$ = selector => [...w.document.querySelectorAll(selector)];
  const click = async selector => { $(selector).click(); await tick(); };
  const input = (selector, value, type = 'input') => { $(selector).value = String(value); $(selector).dispatchEvent(new w.Event(type, { bubbles: true })); };
  const submit = async selector => { $(selector).dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await tick(); };
  return { w, $, $$, click, input, submit, calls, backend, errors, intervals, saved,
    failNext: (path, status = null, data = {}) => queuedFailures.push({ path, status, data }),
    callsFor: path => calls.filter(call => call.path === path), close: () => w.close() };
}

async function test(name, fn, options) {
  if (process.env.EDGE_CHECK_FILTER && !name.toLowerCase().includes(process.env.EDGE_CHECK_FILTER.toLowerCase())) return;
  let app;
  try { app = await setup(options); await fn(app); assert.deepEqual(app.errors, [], 'Runtime errors'); console.log(`PASS ${name}`); passed++; }
  catch (error) { console.error(`FAIL ${name}: ${error.message}`); failed++; }
  finally { app?.close(); }
}

async function choose(a, id = 101, outcome = 'home') { await a.click(`[data-server-odds="${id}"][data-outcome="${outcome}"]`); }
async function stake(a, amount = '10.01') { a.input('#server-stake', amount); await a.submit('#server-stake-form'); }

(async () => {
  await test('Laravel mode loads server fixtures and ignores the demo wallet', async a => {
    assert.equal(a.w.EdgeAPI.serverMode, true);
    assert.ok(a.callsFor('/api/session').length);
    assert.ok(a.callsFor('/api/events').length);
    assert.ok(a.callsFor('/api/state').length);
    assert.match(a.$('#match-list').textContent, /Server Home 101/);
    assert.doesNotMatch(a.$('#match-list').textContent, /Arsenal|Chelsea/);
    assert.equal(a.$('[data-balance]').textContent, '$1,000.00');
    assert.doesNotMatch(a.w.document.body.textContent, /₦|\bNGN\b|\bnaira\b/i);
    assert.equal(a.w.localStorage.getItem('edge-demo-v1'), a.saved);
    assert.equal(a.$('#admin-nav').hidden, true);
  });
  await test('USD labels and dollar amounts are consistent across stakes, wallet forms and account history', async a => {
    await choose(a);
    a.input('#server-stake', '1000');
    assert.match(a.$('label[for="server-stake"]').textContent, /USD/);
    assert.equal(a.$('.stake-input > span').textContent, '$');
    assert.equal(a.$('#server-total-stake').textContent, '$1,000.00');
    assert.match(a.$('#bet-history').textContent, /\$10\.01/);
    assert.match(a.$('#transaction-body').textContent, /\+\$100\.25/);
    assert.match(a.$('#server-wallet-requests').textContent, /\$200\.50/);
    assert.match(a.$('#server-card-payments').textContent, /\$300\.75/);
    for (const action of ['deposit', 'withdraw']) {
      await a.click(`[data-wallet="${action}"]`);
      assert.match(a.$('label[for="wallet-amount"]').textContent, /USD/);
      assert.equal(a.$('.amount-input > span').textContent, '$');
    }
    await a.click('[data-server-copy-fund="11"]');
    assert.match(a.$('#server-copy-form').textContent, /USD/);
    assert.doesNotMatch(a.w.document.body.textContent, /₦|\bNGN\b|\bnaira\b/i);
  }, {state: {
    bets: [{id: 1, reference: 'USD-BET', status: 'pending', type: 'single', stake_cents: 1001, potential_return_cents: 2002, selections: [], created_at: future}],
    transactions: [{id: 1, reference: 'USD-TRANSFER', type: 'deposit', amount_cents: 10025, created_at: future}],
    wallet_requests: [{id: 1, reference: 'USD-REQUEST', type: 'deposit', amount_cents: 20050, status: 'pending', created_at: future}],
    stripe_payments: [{reference: 'USD-CARD', status: 'paid', amount_cents: 30075, currency: 'USD', mode: 'test', created_at: future}],
  }});
  await test('Only authenticated administrators see the operations navigation', async a => {
    assert.equal(a.$('#admin-nav').hidden, false);
    assert.equal(a.w.EdgeAPI.user.is_admin, true);
  }, { admin: true });
  await test('Guests start at zero and staking opens sign in', async a => {
    assert.match(a.$('[data-balance]').textContent, /0\.00/);
    assert.equal(a.callsFor('/api/state').length, 0);
    await choose(a); await stake(a);
    assert.equal(a.$('#auth-form').dataset.mode, 'login');
    assert.equal(a.callsFor('/api/bets').length, 0);
  }, { guest: true });
  await test('Live, finished and past kickoff games cannot be selected', async a => {
    for (const id of [103, 104, 105]) {
      assert.equal(a.$(`[data-server-odds="${id}"]`).disabled, true);
      await choose(a, id);
    }
    assert.equal(a.$('#slip-count').textContent, '0');
  }, { events: [event(103, 'live'), event(104, 'finished'), event(105, 'open', { starts_at: past })] });
  await test('Single mode retains one game and sends accepted odds, version, cents and CSRF', async a => {
    await choose(a, 101); await choose(a, 102); await stake(a, '10.01');
    const calls = a.callsFor('/api/bets'); assert.equal(calls.length, 1);
    assert.equal(calls[0].body.type, 'single'); assert.equal(calls[0].body.stake_cents, 1001);
    assert.equal(calls[0].body.selections.length, 1); assert.equal(calls[0].body.selections[0].event_id, 102);
    assert.equal(calls[0].body.selections[0].expected_odds, '1.1100'); assert.equal(calls[0].body.selections[0].expected_version, 7);
    assert.ok(calls[0].body.idempotency_key.length >= 8); assert.equal(calls[0].headers['X-CSRF-TOKEN'], 'csrf-initial');
    assert.equal(calls[0].credentials, 'same-origin');
  });
  await test('A multiple requires two different events and floors exact decimal potential once', async a => {
    await a.click('[data-bet-type="multiple"]'); await choose(a, 101); await stake(a, '10.01');
    assert.equal(a.callsFor('/api/bets').length, 0); assert.match(a.$('#server-slip-error').textContent, /two different games/i);
    await choose(a, 102); a.input('#server-stake', '10.01');
    assert.match(a.$('#server-potential').textContent, /12\.33/);
    await a.submit('#server-stake-form');
    const call = a.callsFor('/api/bets')[0]; assert.equal(call.body.type, 'multiple'); assert.equal(call.body.selections.length, 2); assert.equal(call.body.stake_cents, 1001);
  });
  await test('Changing from multiple to single prevents partial batched placement', async a => {
    await a.click('[data-bet-type="multiple"]'); await choose(a, 101); await choose(a, 102);
    await a.click('[data-bet-type="single"]'); assert.equal(a.$('#slip-count').textContent, '1');
    await stake(a); assert.equal(a.callsFor('/api/bets').length, 1);
  });
  await test('Backend validation appears beside the slip and retry keeps the request key', async a => {
    await choose(a); a.failNext('/api/bets', 422, { message: 'Validation failed.', errors: { selections: ['Odds changed. Refresh the game.'] } });
    await stake(a); assert.equal(a.$('#server-slip-error').hidden, false); assert.match(a.$('#server-slip-error').textContent, /Odds changed/);
    await a.submit('#server-stake-form');
    const calls = a.callsFor('/api/bets'); assert.equal(calls.length, 2); assert.equal(calls[0].body.idempotency_key, calls[1].body.idempotency_key);
  });
  await test('A network retry after account refresh retains the original idempotency key', async a => {
    await choose(a); a.failNext('/api/bets'); await stake(a);
    const first = a.callsFor('/api/bets')[0].body;
    await a.w.EdgeAPI.refresh(); await tick(); await a.submit('#server-stake-form');
    assert.equal(a.callsFor('/api/bets')[1].body.idempotency_key, first.idempotency_key);
  });
  await test('Login sends credentials and uses the rotated token for the next mutation', async a => {
    a.w.EdgeAPI.openAuth(); a.input('#auth-email', 'member@test.invalid'); a.input('#auth-password', 'Password123456'); await a.submit('#auth-form');
    const login = a.callsFor('/api/auth/login')[0]; assert.deepEqual(login.body, { email: 'member@test.invalid', password: 'Password123456' });
    assert.equal(login.headers['X-CSRF-TOKEN'], 'csrf-initial');
    assert.equal(a.w.EdgeAPI.user,null);assert.ok(a.$('#otp-form'));assert.equal(a.$('#otp-resend').disabled,true);
    a.input('#auth-code','123456');await a.submit('#otp-form');
    assert.deepEqual(a.callsFor('/api/auth/verify')[0].body,{code:'123456'});
    await choose(a); await stake(a);
    assert.equal(a.callsFor('/api/bets')[0].headers['X-CSRF-TOKEN'], 'csrf-auth-rotated');
  }, { guest: true });
  await test('Registration sends name and password confirmation without role or balance fields', async a => {
    a.w.EdgeAPI.openAuth('register'); a.input('#auth-name', 'New Member'); a.input('#auth-email', 'new@test.invalid'); a.input('#auth-password', 'Password123456'); a.input('#auth-confirmation', 'Password123456'); await a.submit('#auth-form');
    assert.deepEqual(a.callsFor('/api/auth/register')[0].body, { name: 'New Member', email: 'new@test.invalid', password: 'Password123456', password_confirmation: 'Password123456' });
    assert.equal(a.w.EdgeAPI.user,null);assert.equal(a.w.document.querySelector('#auth-password'),null);
    a.failNext('/api/auth/verify',422,{errors:{code:['That code is incorrect or expired.']}});
    a.input('#auth-code','000000');await a.submit('#otp-form');
    assert.match(a.$('#otp-error').textContent,/incorrect or expired/);assert.equal(a.w.EdgeAPI.user,null);
    a.input('#auth-code','123456');await a.submit('#otp-form');
    assert.equal(a.w.EdgeAPI.user.name, 'New Member');
  }, { guest: true });
  await test('Deposit requests remain pending without optimistic wallet credit', async a => {
    await a.click('[data-wallet="deposit"]'); a.input('#wallet-amount', '100.25'); a.input('#server-payment-reference', 'PAYMENT-001'); await a.submit('#wallet-form');
    const call = a.callsFor('/api/wallet/requests')[0]; assert.equal(call.body.type, 'deposit'); assert.equal(call.body.amount_cents, 10025); assert.equal(call.body.details.reference, 'PAYMENT-001');
    assert.ok(call.body.idempotency_key); assert.match(a.$('[data-balance]').textContent, /1,000\.00/);
    assert.match(a.$('#server-wallet-requests').textContent, /pending/);
  });
  await test('Withdrawal requests send bank details and show the reserved server balance', async a => {
    await a.click('[data-wallet="withdraw"]'); a.input('#wallet-amount', '100.25'); a.input('#bank-name', 'GTBank', 'change'); a.input('#account-name', 'Test Member'); a.input('#account-number', '1234567890'); await a.submit('#wallet-form');
    const call = a.callsFor('/api/wallet/requests')[0]; assert.equal(call.body.type, 'withdrawal'); assert.equal(call.body.amount_cents, 10025); assert.equal(call.body.details.bank_name, 'GTBank'); assert.equal(call.body.details.account_number, '1234567890');
    assert.match(a.$('[data-balance]').textContent, /899\.75/);
  });
  await test('Copy staking allocates wallet funds through the API', async a => {
    await a.click('[data-server-copy-fund="11"]');
    assert.equal(a.w.document.querySelector('#copy-fund-source'), null);
    a.input('#server-copy-amount', '100.25'); await a.submit('#server-copy-form');
    const call = a.callsFor('/api/copy/positions')[0]; assert.equal(call.body.strategy_id, 11); assert.equal(call.body.amount_cents, 10025); assert.ok(call.body.idempotency_key);
    assert.match(a.$('[data-balance]').textContent, /899\.75/); assert.match(a.$('#copy-total-allocated').textContent, /100\.25/);
  });
  await test('Copy staking cannot manufacture an allocation from insufficient wallet funds', async a => {
    await a.click('[data-server-copy-fund="11"]'); a.input('#server-copy-amount', '2000'); await a.submit('#server-copy-form');
    assert.match(a.$('#server-copy-error').textContent, /wallet balance is too low/); assert.match(a.$('[data-balance]').textContent, /1,000\.00/); assert.match(a.$('#copy-total-allocated').textContent, /0\.00/);
  });
  await test('Signing out clears private account data and zeroes displayed balances', async a => {
    await a.click('#profile-button'); await a.click('#server-logout');
    assert.equal(a.w.EdgeAPI.user, null); assert.match(a.$('[data-balance]').textContent, /0\.00/); assert.equal(a.$('#bets-count').textContent, '0');
    assert.equal(a.$('#admin-nav').hidden, true); assert.match(a.$('#transaction-body').textContent, /No transactions/);
  }, { admin: true, state: { profit_cents: 5000, bets: [{ id: 1, reference: 'Private bet', status: 'pending', type: 'single', stake_cents: 1000, potential_return_cents: 2000, selections: [], created_at: future }], transactions: [{ id: 1, reference: 'PRIVATE-TRANSFER', type: 'deposit', amount_cents: 100000, created_at: future }] } });
  await test('An expired session clears previously rendered private state', async a => {
    a.failNext('/api/state', 401, { message: 'Unauthenticated.' });
    await a.intervals[0](); await tick();
    assert.equal(a.w.EdgeAPI.user, null); assert.equal(a.$('#admin-nav').hidden, true);
    assert.match(a.$('[data-balance]').textContent, /0\.00/); assert.doesNotMatch(a.$('#transaction-body').textContent, /PRIVATE-TRANSFER/);
  }, { admin: true, state: { transactions: [{ id: 1, reference: 'PRIVATE-TRANSFER', type: 'deposit', amount_cents: 100000, created_at: future }] } });

  const bothMethods = { stripe: { enabled: true, mode: 'test' }, manual: { enabled: true, bank_name: 'Example Bank', account_name: 'EDGE Payments', account_number: '1234567890', instructions: 'Transfer only to the displayed account.', reference_label: 'Transfer reference', support_contact: 'payments@example.test' } };
  await test('Configured Stripe opens hosted checkout without crediting the wallet or collecting card data', async a => {
    await a.click('[data-wallet="deposit"]');
    assert.equal(a.$('#wallet-method').value, 'stripe');
    assert.equal(a.$('#server-payment-reference').disabled, true);
    a.input('#wallet-amount', '100.25');
    assert.equal(a.$('#wallet-form').checkValidity(), true);
    await a.submit('#wallet-form');
    const call=a.callsFor('/api/payments/stripe/checkout')[0];
    assert.equal(call.body.amount_cents,10025);assert.ok(call.body.idempotency_key);
    assert.equal(call.headers['X-CSRF-TOKEN'],'csrf-initial');
    assert.equal(a.$('#stripe-checkout-link').href,'https://checkout.stripe.com/c/pay/cs_test_example');
    assert.match(a.$('#info-content').textContent,/test/i);
    assert.equal(a.callsFor('/api/wallet/requests').length,0);
    assert.match(a.$('[data-balance]').textContent,/1,000\.00/);
    assert.equal(a.w.document.querySelector('input[autocomplete="cc-number"]'),null);
  }, {methods:bothMethods});
  await test('Manual fallback displays configured bank details and requires a reference', async a => {
    await a.click('[data-wallet="deposit"]');a.input('#wallet-method','bank_transfer','change');
    assert.equal(a.$('#manual-payment-details').hidden,false);
    assert.match(a.$('#manual-payment-details').textContent,/Example Bank/);
    assert.match(a.$('#manual-payment-details').textContent,/EDGE Payments/);
    assert.match(a.$('#manual-payment-details').textContent,/1234567890/);
    assert.match(a.$('#server-funding-reference label').textContent,/Transfer reference/);
    a.input('#wallet-amount','100');assert.equal(a.$('#wallet-form').checkValidity(),false);
    a.input('#server-payment-reference','MY-TRANSFER-REFERENCE');await a.submit('#wallet-form');
    assert.equal(a.callsFor('/api/wallet/requests')[0].body.method,'bank_transfer');
    assert.equal(a.callsFor('/api/payments/stripe/checkout').length,0);
  }, {methods:bothMethods});
  await test('Switching methods cannot leave hidden manual fields blocking card checkout', async a => {
    await a.click('[data-wallet="deposit"]');a.input('#wallet-method','bank_transfer','change');a.input('#wallet-amount','100');
    assert.equal(a.$('#wallet-form').checkValidity(),false);
    a.input('#wallet-method','stripe','change');assert.equal(a.$('#server-payment-reference').required,false);
    assert.equal(a.$('#wallet-form').checkValidity(),true);
    assert.equal(a.$('#wallet-amount').max,'999999.99');
  }, {methods:bothMethods});
  await test('Card errors retain a retry key and do not fall back to manual credit', async a => {
    await a.click('[data-wallet="deposit"]');a.input('#wallet-amount','100');
    a.failNext('/api/payments/stripe/checkout',503,{message:'Card checkout is temporarily unavailable.'});await a.submit('#wallet-form');
    assert.match(a.$('#wallet-error').textContent,/temporarily unavailable/);
    await a.submit('#wallet-form');const calls=a.callsFor('/api/payments/stripe/checkout');
    assert.equal(calls.length,2);assert.equal(calls[0].body.idempotency_key,calls[1].body.idempotency_key);
    assert.equal(a.callsFor('/api/wallet/requests').length,0);assert.match(a.$('[data-balance]').textContent,/1,000\.00/);
  }, {methods:bothMethods});
  await test('A changed amount after a failed checkout receives a new request key', async a => {
    await a.click('[data-wallet="deposit"]');a.input('#wallet-amount','100');a.failNext('/api/payments/stripe/checkout');await a.submit('#wallet-form');
    a.input('#wallet-amount','200');await a.submit('#wallet-form');const calls=a.callsFor('/api/payments/stripe/checkout');
    assert.notEqual(calls[0].body.idempotency_key,calls[1].body.idempotency_key);assert.equal(calls[1].body.amount_cents,20000);
  }, {methods:bothMethods});
  await test('Disabled deposit channels prevent new deposit submissions', async a => {
    await a.click('[data-wallet="deposit"]');assert.equal(a.$('#wallet-submit').disabled,true);
    a.input('#wallet-amount','100');await a.submit('#wallet-form');
    assert.equal(a.callsFor('/api/wallet/requests').length,0);assert.equal(a.callsFor('/api/payments/stripe/checkout').length,0);
  }, {methods:{stripe:{enabled:false,mode:'test'},manual:{enabled:false}}});
  await test('Disabling manual deposits does not block withdrawal requests', async a => {
    await a.click('[data-wallet="withdraw"]');a.input('#wallet-amount','100');a.input('#bank-name','GTBank','change');a.input('#account-name','Test Member');a.input('#account-number','1234567890');
    assert.equal(a.$('#wallet-submit').disabled,false);await a.submit('#wallet-form');
    assert.equal(a.callsFor('/api/wallet/requests')[0].body.type,'withdrawal');
  }, {methods:{stripe:{enabled:true,mode:'test'},manual:{enabled:false}}});
  await test('A success return URL never creates a wallet credit or marks an unpaid payment paid', async a => {
    assert.match(a.$('#server-card-payments').textContent,/Waiting for card payment confirmation/);
    assert.match(a.$('[data-balance]').textContent,/1,000\.00/);
    assert.equal(a.callsFor('/api/payments/stripe/checkout').length,0);assert.equal(a.callsFor('/api/wallet/requests').length,0);
    await a.click('#refresh-card-payments');assert.match(a.$('#server-card-payments').textContent,/Waiting/);
  }, {hash:'?stripe_return=success&payment_ref=stripe-test-reference#wallet',state:{stripe_payments:[{reference:'stripe-test-reference',status:'pending',amount_cents:10000,mode:'test',created_at:future}]}});
  await test('Only the verified server payment state shows a confirmed card deposit', async a => {
    assert.match(a.$('#server-card-payments').textContent,/Card deposit confirmed/);
    assert.match(a.$('#server-card-payments').textContent,/paid/);
  }, {hash:'?stripe_return=success&payment_ref=stripe-test-reference#wallet',state:{stripe_payments:[{reference:'stripe-test-reference',status:'paid',amount_cents:10000,mode:'test',created_at:future}]}});
  await test('A paid checkout retry refreshes the wallet without opening an invalid link', async a => {
    await a.click('[data-wallet="deposit"]');a.input('#wallet-amount','100');await a.submit('#wallet-form');
    assert.equal(a.w.document.querySelector('#stripe-checkout-link'),null);
    assert.match(a.$('#toast').textContent,/already confirmed/);
    assert.equal(a.$('#wallet-modal').hidden,true);
    assert.equal(a.callsFor('/api/wallet/requests').length,0);
  }, {methods:bothMethods,checkoutPaid:true});
  await test('Unsafe checkout URLs cannot create a card handoff link', async a => {
    await a.click('[data-wallet="deposit"]');a.input('#wallet-amount','100');await a.submit('#wallet-form');
    assert.equal(a.w.document.querySelector('#stripe-checkout-link'),null);assert.match(a.$('#wallet-error').textContent,/unsupported checkout/);
  }, {methods:bothMethods,checkoutUrl:'https://malicious.example.test/checkout'});
  await test('Configured bank details are escaped before rendering', async a => {
    await a.click('[data-wallet="deposit"]');assert.equal(a.w.document.querySelector('#manual-payment-details img'),null);
    assert.match(a.$('#manual-payment-details').textContent,/<img/);
  }, {methods:{stripe:{enabled:false},manual:{enabled:true,bank_name:'<img src=x onerror=alert(1)>',account_name:'Test & Co',account_number:'1234567890'}}});
  await test('Identity uploads preserve multipart data, browser content type and the session CSRF token', async a => {
    const form = new a.w.FormData();form.set('legal_name','Synthetic Member');form.set('id_document',new a.w.File(['synthetic document'],'identity.png',{type:'image/png'}));
    await a.w.EdgeAPI.request('/api/kyc',{method:'POST',body:form});
    const call = a.callsFor('/api/kyc')[0];
    assert.equal(call.body,form);assert.equal(call.body.get('legal_name'),'Synthetic Member');
    assert.equal(call.headers['Content-Type'],undefined);assert.equal(call.headers['X-CSRF-TOKEN'],a.backend.token);assert.equal(call.credentials,'same-origin');
  });
  await test('An unverified withdrawal closes an open wallet dialog and shows identity verification without reserving money', async a => {
    await a.click('[data-wallet="deposit"]');assert.equal(a.$('#wallet-modal').hidden,false);
    a.backend.user.kyc_status='not_submitted';await a.w.EdgeAPI.refresh();
    const before=a.$('[data-balance]').textContent;
    await a.click('[data-modal-wallet="withdraw"]');
    assert.equal(a.$('#wallet-modal').hidden,true);assert.equal(a.$('#verification-page').hidden,false);
    assert.equal(a.w.location.hash,'#verification');assert.match(a.$('#toast').textContent,/identity verification/);
    assert.equal(a.callsFor('/api/wallet/requests').length,0);assert.equal(a.$('[data-balance]').textContent,before);
  });
  await test('Redeeming a promotional code refreshes the wallet and its separate credit filter', async a => {
    a.backend.state.balance_cents=125000;
    a.backend.state.transactions=[{id:77,type:'promo_credit',reference:'promo-code-7',amount_cents:25000,created_at:future}];
    a.w.dispatchEvent(new a.w.CustomEvent('edge:promo-redeemed',{detail:{redemption:{amount_cents:25000}}}));await tick();
    assert.match(a.$('[data-balance]').textContent,/1,250\.00/);
    assert.match(a.$('#transaction-body').textContent,/Promotional credit/);
    a.input('#transaction-filter','promo_credit','change');assert.match(a.$('#transaction-body').textContent,/250\.00/);
    a.input('#transaction-filter','deposit','change');assert.match(a.$('#transaction-body').textContent,/No transactions/);
  });
  const manualCatalog={stripe:{enabled:true,mode:'test'},manual:{enabled:true,bank_name:'Legacy hidden bank'},manual_catalog_configured:true,manual_methods:[{id:7,version:3,name:'Test Mobile Money',enabled:true,deposit_enabled:true,withdrawal_enabled:true,instructions:'Send to TEST-DESTINATION on Test network.',image_url:'/api/manual-payment-methods/7/image?v=3',fields:[{key:'f_account',label:'Mobile account',type:'text',required:true,hint:'Include your country code',options:[]},{key:'f_network',label:'Network',type:'select',required:true,hint:'',options:['One','Two']},{key:'f_note',label:'Payout note',type:'textarea',required:false,hint:'',options:[]}]}]};
  await test('Manual catalog shows configured image and details and omits legacy bank fallback',async a=>{
    await a.click('[data-wallet="deposit"]');a.input('#wallet-method','manual:7','change');
    assert.match(a.$('#manual-payment-details').textContent,/Test Mobile Money/);assert.match(a.$('#manual-payment-details').textContent,/TEST-DESTINATION/);
    assert.match(a.$('#manual-payment-details img').getAttribute('src'),/manual-payment-methods\/7/);assert.doesNotMatch(a.$('#wallet-method').innerHTML,/bank_transfer/);
    a.input('#wallet-amount','100');a.input('#server-payment-reference','USER-REFERENCE');await a.submit('#wallet-form');
    const payload=a.callsFor('/api/wallet/requests')[0].body;assert.equal(payload.method,'manual:7');assert.deepEqual(payload.details,{method_version:3,reference:'USER-REFERENCE'});assert.equal(a.backend.state.balance_cents,100000);
  },{methods:manualCatalog});
  await test('Manual withdrawal uses admin fields and sends only entered recipient answers',async a=>{
    await a.click('[data-wallet="withdraw"]');assert.equal(a.$('#withdraw-fields').hidden,true);assert.equal(a.$('#bank-name').disabled,true);
    assert.equal(a.$('[data-payment-field="f_account"]').required,true);assert.equal(a.$('[data-payment-field="f_note"]').required,false);
    a.input('#wallet-amount','100');a.input('[data-payment-field="f_account"]','+123456789');a.input('[data-payment-field="f_network"]','Two','change');a.input('[data-payment-field="f_note"]',' Test note ');await a.submit('#wallet-form');
    const payload=a.callsFor('/api/wallet/requests')[0].body;assert.equal(payload.type,'withdrawal');assert.deepEqual(payload.details,{method_version:3,answers:{f_account:'+123456789',f_network:'Two',f_note:'Test note'}});assert.equal(a.$('[data-payment-field="f_account"]').value,'');
  },{methods:manualCatalog});
  await test('Empty configured manual catalog disables withdrawal instead of restoring a legacy method',async a=>{
    await a.click('[data-wallet="withdraw"]');assert.equal(a.$('#wallet-submit').disabled,true);assert.match(a.$('#wallet-modal-description').textContent,/No payment methods/);
    a.input('#wallet-amount','100');await a.submit('#wallet-form');assert.equal(a.callsFor('/api/wallet/requests').length,0);
  },{methods:{...manualCatalog,manual_methods:[]}});
  await test('Switching from custom manual deposit to Stripe disables the reference and clears custom fields',async a=>{
    await a.click('[data-wallet="deposit"]');a.input('#wallet-method','manual:7','change');assert.equal(a.$('#server-payment-reference').required,true);
    a.input('#wallet-method','stripe','change');assert.equal(a.$('#server-payment-reference').disabled,true);assert.equal(a.$('#manual-payment-details').hidden,true);a.input('#wallet-amount','100');await a.submit('#wallet-form');assert.equal(a.callsFor('/api/payments/stripe/checkout').length,1);assert.equal(a.callsFor('/api/wallet/requests').length,0);
  },{methods:manualCatalog});
  await test('Open manual form retains its definition version during background refresh',async a=>{
    await a.click('[data-wallet="withdraw"]');a.input('#wallet-amount','100');a.input('[data-payment-field="f_account"]','123');a.input('[data-payment-field="f_network"]','One','change');
    a.backend.methods.manual_methods[0].version=99;a.backend.methods.manual_methods[0].fields=[];await a.w.EdgeAPI.refresh();await a.submit('#wallet-form');assert.equal(a.callsFor('/api/wallet/requests')[0].body.details.method_version,3);
  },{methods:manualCatalog});
  await test('Internal transfer confirms the recipient before password-authorised movement',async a=>{
    assert.equal(a.$('#internal-account-number').textContent,'1234567890');
    assert.equal(a.$('.wallet-card [data-wallet-account-number]').textContent,'1234567890');
    let copied;Object.defineProperty(a.w.navigator,'clipboard',{value:{writeText:async value=>{copied=value;}}});
    await a.click('.wallet-card [data-transfer-copy]');assert.equal(copied,'1234567890');
    await a.click('.wallet-card [data-transfer-open]');a.input('#transfer-account','9876543210');a.input('#transfer-amount','12.34');await a.submit('#transfer-recipient-form');
    assert.match(a.$('.transfer-review').textContent,/Recipient P\./);assert.match(a.$('.transfer-review').textContent,/\$12\.34/);assert.equal(a.callsFor('/api/wallet/transfers').length,0);
    a.input('#transfer-password','SyntheticPassword123');await a.submit('#transfer-send-form');
    const request=a.callsFor('/api/wallet/transfers')[0];assert.equal(request.body.amount_cents,1234);assert.equal(request.body.account_number,'9876543210');assert.equal(request.body.confirmation_token,'test-confirmation');assert.ok(request.body.idempotency_key);
    assert.match(a.$('#transfer-title').textContent,/COMPLETE/);a.w.EdgeAPI.navigate('wallet');await tick();assert.match(a.$('#transfer-history').textContent,/Recipient P\./);assert.equal(a.w.document.querySelector('#transfer-password'),null);
  },{transfers:true});
  await test('An uncertain transfer retry retains its key and never optimistically debits',async a=>{
    await a.click('[data-transfer-open]');a.input('#transfer-account','9876543210');a.input('#transfer-amount','25');await a.submit('#transfer-recipient-form');
    a.failNext('/api/wallet/transfers');a.input('#transfer-password','SyntheticPassword123');await a.submit('#transfer-send-form');
    assert.match(a.$('#transfer-error').textContent,/Network/);assert.equal(a.backend.state.balance_cents,100000);
    const key=a.callsFor('/api/wallet/transfers')[0].body.idempotency_key;
    await a.click('[data-transfer-close]');await a.click('[data-transfer-open]');a.input('#transfer-password','SyntheticPassword123');await a.submit('#transfer-send-form');
    assert.equal(a.callsFor('/api/wallet/transfers')[1].body.idempotency_key,key);assert.equal(a.backend.state.balance_cents,97500);
  },{transfers:true,hash:'#wallet'});
  await test('Signing out clears transfer recipients, account number and history',async a=>{
    await a.click('[data-transfer-open]');a.input('#transfer-account','9876543210');a.input('#transfer-amount','25');await a.submit('#transfer-recipient-form');
    await a.click('[data-transfer-close]');await a.click('#profile-button');await a.click('#server-logout');
    assert.equal(a.$('#transfer-modal').hidden,true);assert.equal(a.w.document.querySelector('#internal-account-number'),null);assert.doesNotMatch(a.$('#wallet-transfers').textContent,/1234567890|Recipient/);
    assert.doesNotMatch(a.$('#transfer-content').textContent,/Recipient/);
    assert.equal(a.$('.wallet-card [data-wallet-account-number]').textContent,'Sign in to view');
    assert.equal(a.$('.wallet-card [data-transfer-copy]').disabled,true);
  },{transfers:true,hash:'#wallet'});
  console.log(`${passed} server UI checks passed; ${failed} failed.`);
  if (failed) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
