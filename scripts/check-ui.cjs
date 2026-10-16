#!/usr/bin/env node
/* Optional DOM integration checks. Install jsdom outside the repository, then run:
   EDGE_JSDOM_PATH=/private/tmp/edge-dom-qa/node_modules/jsdom node scripts/check-ui.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require(process.env.EDGE_JSDOM_PATH || 'jsdom')); }
catch { console.error('Install jsdom in a temporary folder and set EDGE_JSDOM_PATH to its module path.'); process.exit(1); }
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'resources/views/app.blade.php'), 'utf8');
const script = fs.readFileSync(path.join(root, 'public/assets/app.js'), 'utf8');
const storeKey = 'edge-demo-v1';
let passed = 0, failed = 0;

function setup({ state, hash = '' } = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(html, { url: `http://localhost:8000/${hash}`, runScripts: 'outside-only', virtualConsole: vc });
  const w = dom.window;
  w.scrollTo = () => {};
  w.HTMLElement.prototype.scrollIntoView = () => {};
  if (state !== undefined) w.localStorage.setItem(storeKey, typeof state === 'string' ? state : JSON.stringify(state));
  try { w.eval(script); } catch (e) { errors.push(e.message); }
  const $ = selector => { const el = w.document.querySelector(selector); assert.ok(el, `Missing element ${selector}`); return el; };
  const $$ = selector => [...w.document.querySelectorAll(selector)];
  const click = selector => $(selector).click();
  const input = (selector, value, event = 'input') => { const el = $(selector); el.value = String(value); el.dispatchEvent(new w.Event(event, { bubbles: true })); };
  const submit = selector => $(selector).dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  const stateNow = () => JSON.parse(w.localStorage.getItem(storeKey));
  const close = () => w.close();
  return { dom, w, $, $$, click, input, submit, stateNow, errors, close };
}
function test(name, fn) {
  let app;
  try { app = setup(); fn(app); assert.deepEqual(app.errors, [], 'Runtime errors'); console.log(`PASS ${name}`); passed++; }
  catch (e) { console.error(`FAIL ${name}: ${e.message}`); failed++; }
  finally { app?.close(); }
}
function openDeposit(a, amount) { a.click('[data-wallet="deposit"]'); a.input('#wallet-amount', amount); }
function openWithdraw(a, amount, { bank = 'GTBank', account = '0123456789', name = 'Demo User' } = {}) {
  a.click('[data-wallet="withdraw"]'); a.input('#wallet-amount', amount);
  a.input('#bank-name', bank, 'change'); a.input('#account-number', account); a.input('#account-name', name);
}
function add(a, id = 'ars-che', outcome = 0) { a.click(`[data-odds="${id}"][data-outcome="${outcome}"]`); }
function expectNoSave(a) { assert.equal(a.stateNow(), null, 'Invalid operation changed stored state'); }

test('Initial render, balances and active stakes', a => {
  assert.equal(a.$('#bets-count').textContent, '2');
  assert.match(a.$('[data-balance]').textContent, /124,500\.00/);
  assert.match(a.$('[data-stakes]').textContent, /8,500\.00/);
  assert.match(a.$('[data-returns]').textContent, /21,675\.00/);
  assert.equal(a.$$('.match-card').length, 4);
  assert.equal(a.$('#sports-page').hidden, false);
});

test('Deposit updates balance, transactions, and success confirmation', a => {
  openDeposit(a, '2500.75'); a.input('#wallet-method', 'card', 'change'); a.submit('#wallet-form');
  const s = a.stateNow(); assert.equal(s.balance, 127000.75); assert.equal(s.profit, 24500);
  assert.equal(s.transactions[0].amount, 2500.75); assert.equal(s.transactions[0].type, 'deposit');
  assert.match(s.transactions[0].title, /Debit card/); assert.equal(a.$('#wallet-modal').hidden, true);
  assert.equal(a.$('#info-modal').hidden, false); assert.match(a.$('#info-title').textContent, /FUNDED/);
  assert.match(a.$('#transaction-body').textContent, /2,500\.75/);
});

for (const amount of ['', 0, -1, 99.99, 100.001, 1000000.01]) {
  test(`Deposit rejects invalid amount ${JSON.stringify(amount)}`, a => {
    openDeposit(a, amount); a.submit('#wallet-form');
    expectNoSave(a); assert.equal(a.$('#wallet-error').hidden, false);
  });
}

test('Deposit preset and exact transaction limit work', a => {
  a.click('[data-wallet="deposit"]'); a.click('[data-amount="10000"]'); assert.equal(a.$('#wallet-amount').value, '10000');
  a.input('#wallet-amount', 1000000); a.submit('#wallet-form'); assert.equal(a.stateNow().balance, 1124500);
});

test('Withdrawal supports available stake and profit', a => {
  openWithdraw(a, '30000.25'); assert.equal(a.$('#bank-name').required, true); a.submit('#wallet-form');
  const s = a.stateNow(); assert.equal(s.balance, 94499.75); assert.equal(s.profit, 24500);
  assert.equal(s.transactions[0].amount, -30000.25); assert.equal(s.transactions[0].type, 'withdrawal');
  assert.match(a.$('#info-content').textContent, /6789/); assert.doesNotMatch(a.$('#info-content').textContent, /0123456789/);
  assert.match(a.$('#info-title').textContent, /WITHDRAWAL COMPLETE/);
});

test('Withdrawal rejects amount above available balance', a => {
  openWithdraw(a, 124500.01); a.submit('#wallet-form'); expectNoSave(a);
  assert.match(a.$('#wallet-error').textContent, /exceeds your available balance/);
});

for (const details of [{bank:''}, {account:'123'}, {account:'abcdefghij'}, {name:' '}, {name:'A'}]) {
  test(`Withdrawal rejects incomplete bank details ${JSON.stringify(details)}`, a => {
    openWithdraw(a, 1000, details); a.submit('#wallet-form'); expectNoSave(a);
    assert.equal(a.$('#wallet-error').hidden, false); assert.match(a.$('#wallet-error').textContent, /bank.*10-digit/);
  });
}

test('Withdrawing entire available balance leaves zero', a => {
  openWithdraw(a, 124500); a.submit('#wallet-form'); assert.equal(a.stateNow().balance, 0);
  assert.match(a.$('[data-balance]').textContent, /0\.00/);
});

test('Wallet mode switches constraints and Escape closes dialog', a => {
  a.click('[data-wallet="withdraw"]'); assert.equal(a.$('#withdraw-fields').hidden, false);
  a.click('[data-modal-wallet="deposit"]'); assert.equal(a.$('#withdraw-fields').hidden, true);
  assert.equal(a.$('#bank-name').required, false); assert.equal(a.$('#wallet-amount').max, '1000000');
  a.w.document.dispatchEvent(new a.w.KeyboardEvent('keydown', {key:'Escape',bubbles:true}));
  assert.equal(a.$('#wallet-modal').hidden, true); assert.equal(a.w.document.body.style.overflow, '');
});

test('Invalid withdrawal details cannot block a later deposit through native validation', a => {
  openWithdraw(a, 1000, {account:'123'}); assert.equal(a.$('#wallet-form').checkValidity(), false);
  a.click('[data-modal-wallet="deposit"]'); a.input('#wallet-amount', 1000);
  assert.equal(a.$('#wallet-form').checkValidity(), true, 'Hidden withdrawal fields still prevent a valid deposit');
  a.$('#wallet-form').requestSubmit(); assert.equal(a.stateNow().balance, 125500);
});

test('Odds toggle, replace same fixture outcome, and remove correctly', a => {
  add(a); assert.equal(a.$('#slip-count').textContent, '1'); assert.equal(a.$('[data-odds="ars-che"][data-outcome="0"]').getAttribute('aria-pressed'), 'true');
  add(a, 'ars-che', 2); assert.equal(a.$('#slip-count').textContent, '1'); assert.match(a.$('#slip-content').textContent, /Chelsea to win/);
  add(a, 'ars-che', 2); assert.equal(a.$('#slip-count').textContent, '0');
  add(a); a.click('[data-remove="ars-che"]'); assert.equal(a.$('#slip-count').textContent, '0');
});

test('Single stake uses selected odds, deducts balance, and records bet', a => {
  add(a); a.input('#stake-amount', '1000.50'); assert.match(a.$('#slip-potential-return').textContent, /1,850\.93/);
  a.submit('#stake-form'); const s = a.stateNow(); assert.equal(s.balance, 123499.5);
  assert.equal(s.bets[0].stake, 1000.5); assert.equal(s.bets[0].returns, 1850.93); assert.equal(s.bets[0].odds, 1.85);
  assert.equal(s.bets[0].status, 'active'); assert.equal(s.transactions[0].amount, -1000.5);
  assert.equal(a.$('#slip-count').textContent, '0'); assert.equal(a.$('#bets-count').textContent, '3');
});

test('Two singles deduct stake for each selected fixture', a => {
  add(a); add(a, 'mci-rma'); a.input('#stake-amount', 1000);
  assert.match(a.$('#slip-total-stake').textContent, /2,000\.00/); assert.match(a.$('#slip-potential-return').textContent, /4,000\.00/);
  a.submit('#stake-form'); const s = a.stateNow(); assert.equal(s.balance, 122500); assert.equal(s.bets.length, 5);
  assert.equal(s.bets[0].stake, 1000); assert.equal(s.bets[1].stake, 1000); assert.equal(s.transactions[0].amount, -2000);
});

test('Accumulator combines odds and deducts one stake', a => {
  add(a); add(a, 'mci-rma'); a.click('[data-bet-type="multiple"]'); a.input('#stake-amount', 1000);
  assert.match(a.$('#slip-total-stake').textContent, /1,000\.00/); assert.match(a.$('#slip-potential-return').textContent, /3,977\.50/);
  a.submit('#stake-form'); const s = a.stateNow(); assert.equal(s.balance, 123500); assert.equal(s.bets.length, 4);
  assert.equal(s.bets[0].title, '2-selection accumulator'); assert.equal(s.bets[0].returns, 3977.5);
  assert.equal(s.transactions[0].amount, -1000);
});

for (const stake of ['', 0, -1, 99.99, 100.001, 124500.01, 1000001]) {
  test(`Stake rejects invalid or unaffordable amount ${JSON.stringify(stake)}`, a => {
    add(a); a.input('#stake-amount', stake); a.submit('#stake-form'); expectNoSave(a); assert.equal(a.$('#slip-error').hidden, false);
  });
}

test('Stake presets add and clear slip resets values', a => {
  add(a); a.click('[data-stake="500"]'); a.click('[data-stake="1000"]'); assert.equal(a.$('#stake-amount').value, '1500');
  a.click('#clear-slip'); assert.equal(a.$('#slip-count').textContent, '0'); add(a); assert.equal(a.$('#stake-amount').value, '');
});

test('Cash out credits return and only profit, settles bet, records transaction', a => {
  a.click('[data-page="bets"]'); a.click('[data-cashout="ED-10482"]'); expectNoSave(a);
  a.click('[data-confirm-cashout="ED-10482"]'); const s = a.stateNow();
  assert.equal(s.balance, 129900); assert.equal(s.profit, 24900); assert.equal(s.bets[0].status, 'cashed'); assert.equal(s.bets[0].returns, 5400);
  assert.equal(s.transactions[0].type, 'return'); assert.equal(s.transactions[0].amount, 5400);
  assert.equal(a.$('#bets-count').textContent, '1'); assert.equal(a.$$('[data-cashout="ED-10482"]').length, 0);
  a.click('[data-close-modal]'); a.click('[data-bet-filter="settled"]'); assert.match(a.$('#bet-history').textContent, /CASHED OUT/);
});

test('Navigation, history, live events and sport/league filters', a => {
  for (const page of ['games', 'wallet', 'bets', 'sports']) { a.click(`[data-page="${page}"]`); assert.equal(a.$(`#${page}-page`).hidden, false); assert.equal(a.w.location.hash, `#${page}`); }
  a.click('[data-page="live"]'); assert.equal(a.$('#live-filter').classList.contains('active'), true); assert.equal(a.$$('.match-card').length, 4); assert.equal(a.$$('.live-tag').length, 4);
  a.click('[data-page="sports"]'); a.click('[data-sport="basketball"]'); assert.equal(a.$$('.match-card').length, 1); assert.match(a.$('#match-list').textContent, /LA Lakers/);
  a.click('[data-sport="football"]'); a.click('[data-league="Champions League"]'); assert.equal(a.$$('.match-card').length, 2); assert.doesNotMatch(a.$('#match-list').textContent, /Arsenal/);
  a.click('#live-filter'); assert.match(a.$('#match-list').textContent, /No events/); a.click('[data-reset-filters]'); assert.equal(a.$$('.match-card').length, 4);
});

test('Search and expanded fixtures filter the market', a => {
  a.click('#search-toggle'); assert.equal(a.$('#match-search').hidden, false); a.input('#search-input', 'Sinner'); assert.equal(a.$$('.match-card').length, 1);
  a.input('#search-input', 'no-matching-team'); assert.equal(a.$$('.match-card').length, 0); a.click('[data-reset-filters]');
  a.click('#view-all-events'); assert.equal(a.$$('.match-card').length, 9); a.click('#view-all-events'); assert.equal(a.$$('.match-card').length, 4);
});

test('Transaction filters show selected transaction types', a => {
  a.click('[data-page="wallet"]'); a.input('#transaction-filter', 'deposit', 'change'); assert.equal(a.$$('#transaction-body tr').length, 2);
  assert.doesNotMatch(a.$('#transaction-body').textContent, /Withdrawal|Stake|Winnings/);
  a.input('#transaction-filter', 'withdrawal', 'change'); assert.equal(a.$$('#transaction-body tr').length, 1); assert.match(a.$('#transaction-body').textContent, /20,000\.00/);
});

test('Game previews play free rounds without wallet mutation', a => {
  for (const id of ['dice', 'crash', 'hoops']) { a.click(`[data-game="${id}"]`); a.click(`[data-play="${id}"]`); assert.notEqual(a.$('#arcade-result').textContent, 'Ready when you are.'); a.click('#info-modal [data-close-modal]'); }
  expectNoSave(a); assert.match(a.$('[data-balance]').textContent, /124,500\.00/);
});

test('Saved balances, bets and transactions survive reload', a => {
  openDeposit(a, 1000); a.submit('#wallet-form'); const saved = a.stateNow();
  const b = setup({ state: saved, hash:'#wallet' });
  try { assert.deepEqual(b.errors, []); assert.match(b.$('[data-balance]').textContent, /125,500\.00/); assert.equal(b.$('#wallet-page').hidden, false); assert.equal(b.$$('#transaction-body tr').length, 7); }
  finally { b.close(); }
});

test('Malformed localStorage falls back to the demo wallet', a => {
  for (const state of ['{bad json', '{}', {balance:'invalid',bets:[],transactions:[]}]) {
    const b = setup({ state }); try { assert.deepEqual(b.errors, []); assert.match(b.$('[data-balance]').textContent, /124,500\.00/); } finally { b.close(); }
  }
});

test('Profile reset restores demo state after mutation', a => {
  openDeposit(a, 1000); a.submit('#wallet-form'); a.click('#info-modal [data-close-modal]');
  a.click('#profile-button'); a.click('[data-info="account"]'); a.click('#reset-demo');
  assert.equal(a.stateNow().balance, 124500); assert.equal(a.stateNow().transactions.length, 6); assert.equal(a.$('#info-modal').hidden, true);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
