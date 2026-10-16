#!/usr/bin/env node
/* Optional Copy Staking DOM integration checks. Run with an external jsdom install:
   EDGE_JSDOM_PATH=/private/tmp/edge-dom-qa/node_modules/jsdom node scripts/check-copy-ui.cjs */
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
  try { w.eval(script); } catch (error) { errors.push(error.message); }
  const $ = selector => { const el = w.document.querySelector(selector); assert.ok(el, `Missing element ${selector}`); return el; };
  const $$ = selector => [...w.document.querySelectorAll(selector)];
  const click = selector => $(selector).click();
  const input = (selector, value, event = 'input') => { const el = $(selector); el.value = String(value); el.dispatchEvent(new w.Event(event, { bubbles: true })); };
  const submit = selector => $(selector).dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  const stateNow = () => JSON.parse(w.localStorage.getItem(storeKey));
  const clickAction = (name, value) => {
    const button = w.document.createElement('button');
    button.setAttribute(`data-${name}`, value);
    w.document.body.append(button); button.click(); button.remove();
  };
  return { w, $, $$, click, input, submit, stateNow, clickAction, errors, close: () => w.close() };
}
function test(name, fn, options) {
  let app;
  try { app = setup(options); fn(app); assert.deepEqual(app.errors, [], 'Runtime errors'); console.log(`PASS ${name}`); passed++; }
  catch (error) { console.error(`FAIL ${name}: ${error.message}`); failed++; }
  finally { app?.close(); }
}
function fund(a, { strategy = 'touchline', amount = 5000, source = 'wallet', method = 'bank', submit = true } = {}) {
  a.click(`[data-copy-fund="${strategy}"]`);
  a.input('#copy-fund-source', source, 'change');
  if (source === 'deposit') a.input('#copy-fund-method', method, 'change');
  a.input('#copy-fund-amount', amount);
  if (submit) a.submit('#copy-fund-form');
}
function closeModal(a) { a.click('#info-modal [data-close-modal]'); }
function noSave(a) { assert.equal(a.stateNow(), null, 'Rejected action changed persistent state'); }
function position(a, strategy = 'touchline') {
  const p = a.stateNow().copyPositions.find(p => p.strategyId === strategy && p.status !== 'closed');
  assert.ok(p, `No open position for ${strategy}`); return p;
}
function seed(overrides = {}) {
  return { balance: 10000, profit: 0, bets: [], transactions: [], copyPositions: [], ...overrides };
}
function savedPosition(overrides = {}) {
  return { id: 'CP-FIXTURE', strategyId: 'touchline', principal: 5000, profit: 1000, value: 6000,
    status: 'active', date: '2026-10-16T08:00:00.000Z', rounds: 1, stakeLimit: 0.02, ...overrides };
}

test('Copy Staking navigation opens its page with three fundable strategies', a => {
  a.click('[data-page="copy"]');
  assert.equal(a.$('#copy-page').hidden, false); assert.equal(a.$('#sports-page').hidden, true);
  assert.equal(a.w.location.hash, '#copy'); assert.match(a.w.document.title, /copy/i);
  for (const id of ['touchline', 'court', 'mixed']) assert.ok(a.$(`#copy-strategy-list [data-copy-fund="${id}"]`));
  assert.match(a.$('#copy-total-allocated').textContent, /0\.00/);
  assert.match(a.$('#copy-total-profit').textContent, /0\.00/);
  assert.equal(a.$('#copy-active-count').textContent.trim(), '0');
  noSave(a);
});

test('A direct Copy Staking URL opens the correct page', a => {
  assert.equal(a.$('#copy-page').hidden, false); assert.equal(a.$('#sports-page').hidden, true);
}, { hash: '#copy' });

test('Risk filters show the strategy matching each selected approach', a => {
  const strategies = { measured: 'court', balanced: 'touchline', dynamic: 'mixed' };
  for (const [risk, id] of Object.entries(strategies)) {
    a.input('#copy-risk-filter', risk, 'change');
    const buttons = a.$$('#copy-strategy-list [data-copy-fund]');
    assert.equal(buttons.length, 1); assert.equal(buttons[0].dataset.copyFund, id);
  }
  a.input('#copy-risk-filter', 'all', 'change');
  assert.equal(a.$$('#copy-strategy-list [data-copy-fund]').length, 3); noSave(a);
});

test('Wallet allocation moves available funds into a separate copy position', a => {
  fund(a, { amount: 5000.25 }); const s = a.stateNow(), p = position(a);
  assert.equal(s.balance, 119499.75); assert.equal(s.profit, 24500);
  assert.equal(p.principal, 5000.25); assert.equal(p.value, 5000.25); assert.equal(p.profit, 0);
  assert.equal(p.status, 'active'); assert.equal(p.rounds, 0); assert.equal(p.stakeLimit, 0.02);
  assert.equal(s.copyPositions.length, 1); assert.equal(s.transactions.length, 7);
  assert.equal(s.transactions[0].amount, -5000.25); assert.match(s.transactions[0].title, /copy/i);
  assert.match(a.$('#copy-total-allocated').textContent, /5,000\.25/);
  assert.equal(a.$('#copy-active-count').textContent.trim(), '1');
  assert.equal(a.$('#info-modal').hidden, false);
});

for (const amount of ['', 0, -1, 4999.99, 5000.001, 1000000.01]) {
  test(`Copy funding rejects invalid amount ${JSON.stringify(amount)}`, a => {
    fund(a, { amount }); noSave(a); assert.equal(a.$('#copy-fund-error').hidden, false);
  });
}

test('Copy funding enforces native number constraints before submission', a => {
  fund(a, { amount: 4999.99, submit: false });
  assert.equal(a.$('#copy-fund-amount').required, true);
  assert.equal(a.$('#copy-fund-form').checkValidity(), false);
  a.$('#copy-fund-form').requestSubmit(); noSave(a);
  a.input('#copy-fund-amount', 5000.25);
  assert.equal(a.$('#copy-fund-form').checkValidity(), true);
  a.$('#copy-fund-form').requestSubmit(); assert.equal(position(a).principal, 5000.25);
});

test('Wallet allocation rejects unavailable funds without changing balances', a => {
  fund(a, { amount: 124500.01 }); noSave(a);
  assert.equal(a.$('#copy-fund-error').hidden, false);
  assert.match(a.$('#copy-fund-error').textContent, /balance|available|insufficient/i);
});

test('Users can allocate their entire available wallet balance', a => {
  fund(a, { amount: 124500 }); assert.equal(a.stateNow().balance, 0);
  assert.equal(position(a).principal, 124500);
});

for (const method of ['bank', 'card']) {
  test(`Direct ${method} deposit is recorded and immediately allocated`, a => {
    fund(a, { strategy: 'court', amount: 10000.75, source: 'deposit', method });
    const s = a.stateNow(), p = position(a, 'court');
    assert.equal(s.balance, 124500); assert.equal(s.profit, 24500);
    assert.equal(p.principal, 10000.75); assert.equal(p.value, 10000.75);
    assert.equal(s.transactions.length, 8);
    const tx = s.transactions.slice(0, 2);
    const deposit = tx.find(t => t.type === 'deposit'), allocation = tx.find(t => t.amount < 0);
    assert.ok(deposit, 'Direct funding must record its deposit');
    assert.equal(deposit.amount, 10000.75);
    assert.match(deposit.title, method === 'card' ? /card/i : /bank/i);
    assert.ok(allocation, 'Direct funding must record its allocation');
    assert.equal(allocation.amount, -10000.75); assert.match(allocation.title, /copy/i);
    assert.equal(tx.reduce((sum, t) => sum + t.amount, 0), 0);
  });
}

test('Direct deposit supports the exact transaction maximum', a => {
  fund(a, { amount: 1000000, source: 'deposit' });
  assert.equal(position(a).principal, 1000000); assert.equal(a.stateNow().balance, 124500);
});

test('Switching funding sources keeps hidden payment fields from blocking wallet allocation', a => {
  fund(a, { source: 'deposit', amount: 5000, submit: false });
  a.input('#copy-fund-method', '', 'change');
  assert.equal(a.$('#copy-fund-form').checkValidity(), false);
  a.input('#copy-fund-source', 'wallet', 'change');
  assert.equal(a.$('#copy-fund-method').disabled, true);
  assert.equal(a.$('#copy-fund-form').checkValidity(), true);
  a.$('#copy-fund-form').requestSubmit(); assert.equal(position(a).principal, 5000);
});

test('Funding rejects an unsupported source', a => {
  fund(a, { amount: 5000, submit: false });
  a.input('#copy-fund-source', 'unsupported', 'change'); a.submit('#copy-fund-form'); noSave(a);
  assert.equal(a.$('#copy-fund-error').hidden, false);
});

test('Direct funding rejects an unsupported payment method', a => {
  fund(a, { amount: 5000, source: 'deposit', submit: false });
  a.input('#copy-fund-method', 'unsupported', 'change'); a.submit('#copy-fund-form'); noSave(a);
  assert.equal(a.$('#copy-fund-error').hidden, false);
});

test('Adding funds to an existing strategy increases its principal without duplicating positions', a => {
  fund(a); const id = position(a).id; closeModal(a);
  fund(a, { amount: 7500 }); const s = a.stateNow(), p = position(a);
  assert.equal(s.copyPositions.length, 1); assert.equal(p.id, id);
  assert.equal(p.principal, 12500); assert.equal(p.value, 12500); assert.equal(p.profit, 0);
  assert.equal(s.balance, 112000);
});

test('Adding funds preserves existing copied profit and round history', a => {
  fund(a); const s = a.stateNow(), p = position(a);
  assert.equal(s.balance, 5000); assert.equal(s.profit, 1000);
  assert.equal(s.copyPositions.length, 1); assert.equal(p.id, 'CP-FIXTURE');
  assert.equal(p.principal, 10000); assert.equal(p.profit, 1000); assert.equal(p.value, 11000);
  assert.equal(p.rounds, 1); assert.equal(p.history.length, 1);
}, { state: seed({ profit: 1000, copyPositions: [savedPosition({ history: [{ round: 1, stake: 100, profit: 85 }] })] }), hash: '#copy' });

test('Strategies have independent allocations and wallet arithmetic', a => {
  for (const strategy of ['touchline', 'court', 'mixed']) { fund(a, { strategy }); closeModal(a); }
  const s = a.stateNow(); assert.equal(s.balance, 109500); assert.equal(s.copyPositions.length, 3);
  assert.equal(new Set(s.copyPositions.map(p => p.id)).size, 3, 'Position IDs must be unique');
  assert.equal(a.$('#copy-active-count').textContent.trim(), '3');
  assert.match(a.$('#copy-total-allocated').textContent, /15,000\.00/);
});

test('Pause and resume preserve allocated funds and do not create transactions', a => {
  fund(a); const id = position(a).id; closeModal(a); const before = a.stateNow();
  a.click(`[data-copy-pause="${id}"]`); let s = a.stateNow();
  assert.equal(s.copyPositions[0].status, 'paused'); assert.equal(s.balance, before.balance);
  assert.equal(s.copyPositions[0].value, 5000); assert.equal(s.transactions.length, before.transactions.length);
  a.click(`[data-copy-resume="${id}"]`); s = a.stateNow();
  assert.equal(s.copyPositions[0].status, 'active'); assert.equal(s.balance, before.balance);
  assert.equal(s.transactions.length, before.transactions.length);
});

test('Funding a paused strategy preserves its paused state', a => {
  fund(a); const id = position(a).id; closeModal(a); a.click(`[data-copy-pause="${id}"]`);
  fund(a, { amount: 10000 }); const p = position(a);
  assert.equal(p.id, id); assert.equal(p.principal, 15000); assert.equal(p.value, 15000);
  assert.equal(p.status, 'paused'); assert.equal(a.stateNow().copyPositions.length, 1);
});

test('An explicit copied round updates value and profit without changing available funds', a => {
  fund(a); const id = position(a).id; closeModal(a); const before = a.stateNow();
  a.click(`[data-copy-round="${id}"]`); let s = a.stateNow(), p = position(a);
  assert.equal(p.rounds, 1); assert.equal(p.principal, 5000); assert.equal(p.profit, 85); assert.equal(p.value, 5085);
  assert.equal(s.balance, before.balance); assert.equal(s.profit, before.profit + 85);
  assert.equal(p.history.length, 1); assert.match(a.$('#copy-total-profit').textContent, /85\.00/);
  a.click(`[data-copy-round="${id}"]`); s = a.stateNow(); p = position(a);
  assert.equal(p.rounds, 2); assert.equal(p.profit, -16.7); assert.equal(p.value, 4983.3);
  assert.equal(p.history.length, 2); assert.equal(s.balance, before.balance); assert.equal(s.profit, 24483.3);
});

test('A paused position does not simulate copied rounds', a => {
  fund(a); const id = position(a).id; closeModal(a); a.click(`[data-copy-pause="${id}"]`);
  const paused = a.stateNow(); a.clickAction('copy-round', id); assert.deepEqual(a.stateNow(), paused);
  a.click(`[data-copy-resume="${id}"]`); a.click(`[data-copy-round="${id}"]`);
  assert.equal(position(a).rounds, 1);
});

test('Closing requires confirmation, releases its current value, and records its return', a => {
  const before = a.stateNow(); a.click('[data-copy-close="CP-FIXTURE"]');
  assert.deepEqual(a.stateNow(), before, 'Opening confirmation must not change funds');
  a.click('[data-confirm-copy-close="CP-FIXTURE"]'); const s = a.stateNow();
  assert.equal(s.balance, 16000); assert.equal(s.profit, 1000);
  assert.equal(s.copyPositions[0].status, 'closed'); assert.equal(s.copyPositions[0].principal, 5000);
  assert.equal(s.transactions.length, 1); assert.equal(s.transactions[0].amount, 6000);
  assert.equal(s.transactions[0].type, 'copy');
  assert.equal(a.$('#copy-active-count').textContent.trim(), '0');
  assert.match(a.$('#copy-total-allocated').textContent, /0\.00/);
}, { state: seed({ profit: 1000, copyPositions: [savedPosition()] }), hash: '#copy' });

test('Closing a position with a loss credits only its remaining value', a => {
  a.click('[data-copy-close="CP-FIXTURE"]'); a.click('[data-confirm-copy-close="CP-FIXTURE"]');
  const s = a.stateNow(); assert.equal(s.balance, 14900); assert.equal(s.profit, -100);
  assert.equal(s.transactions[0].amount, 4900);
}, { state: seed({ profit: -100, copyPositions: [savedPosition({ profit: -100, value: 4900 })] }), hash: '#copy' });

test('A closed position cannot be paid out twice, resumed, paused, or simulated', a => {
  a.click('[data-copy-close="CP-FIXTURE"]'); a.click('[data-confirm-copy-close="CP-FIXTURE"]');
  const closed = a.stateNow();
  for (const action of ['confirm-copy-close', 'copy-close', 'copy-resume', 'copy-pause', 'copy-round']) {
    a.clickAction(action, 'CP-FIXTURE'); assert.deepEqual(a.stateNow(), closed, `${action} changed a closed position`);
  }
}, { state: seed({ copyPositions: [savedPosition()] }), hash: '#copy' });

test('Position filters retain paused allocations and expose closed history', a => {
  assert.ok(a.$('[data-copy-resume="CP-PAUSED"]')); assert.equal(a.$$('[data-copy-close="CP-CLOSED"]').length, 0);
  a.click('[data-copy-position-filter="all"]');
  assert.match(a.$('#copy-page').textContent, /CP-CLOSED/);
  a.click('[data-copy-position-filter="active"]');
  assert.doesNotMatch(a.$('#copy-page').textContent, /CP-CLOSED/);
  assert.ok(a.$('[data-copy-resume="CP-PAUSED"]'));
}, { state: seed({ copyPositions: [savedPosition({ id: 'CP-PAUSED', status: 'paused' }), savedPosition({ id: 'CP-CLOSED', strategyId: 'court', status: 'closed' })] }), hash: '#copy' });

test('Funding a previously closed strategy creates a new active position', a => {
  fund(a); const s = a.stateNow(); assert.equal(s.copyPositions.length, 2);
  assert.equal(s.copyPositions.find(p => p.id === 'CP-FIXTURE').status, 'closed');
  const p = position(a); assert.notEqual(p.id, 'CP-FIXTURE'); assert.equal(p.principal, 5000);
  assert.equal(p.profit, 0); assert.equal(p.value, 5000); assert.equal(p.rounds, 0);
  assert.equal(s.balance, 5000);
}, { state: seed({ copyPositions: [savedPosition({ status: 'closed' })] }), hash: '#copy' });

test('Saved Copy Staking allocations survive reload', a => {
  fund(a, { strategy: 'mixed', amount: 10000.25 }); const saved = a.stateNow();
  const b = setup({ state: saved, hash: '#copy' });
  try {
    assert.deepEqual(b.errors, []); assert.equal(b.$('#copy-page').hidden, false);
    assert.deepEqual(b.stateNow(), saved); assert.match(b.$('#copy-total-allocated').textContent, /10,000\.25/);
    assert.match(b.$('[data-balance]').textContent, /114,499\.75/);
    assert.ok(b.$(`[data-copy-close="${saved.copyPositions[0].id}"]`));
  } finally { b.close(); }
});

test('An older saved wallet without copyPositions keeps its balance and activity', a => {
  assert.equal(a.$('#copy-active-count').textContent.trim(), '0');
  assert.match(a.$('[data-balance]').textContent, /10,000\.00/);
  fund(a); const s = a.stateNow(); assert.equal(s.balance, 5000);
  assert.equal(s.profit, 321); assert.equal(s.copyPositions.length, 1);
  assert.equal(s.transactions.length, 2); assert.equal(s.transactions[1].id, 'TX-LEGACY');
}, { state: { balance: 10000, profit: 321, bets: [], transactions: [{ id: 'TX-LEGACY', type: 'deposit', title: 'Legacy deposit', amount: 10000, date: '2026-10-15T08:00:00.000Z' }] }, hash: '#copy' });

test('Profile reset clears copy allocations and restores the demo wallet', a => {
  fund(a); closeModal(a); a.click('#profile-button'); a.click('[data-info="account"]'); a.click('#reset-demo');
  const s = a.stateNow(); assert.equal(s.balance, 124500); assert.equal(s.profit, 24500);
  assert.deepEqual(s.copyPositions, []); assert.equal(s.transactions.length, 6);
  assert.equal(a.$('#copy-active-count').textContent.trim(), '0');
  assert.match(a.$('#copy-total-allocated').textContent, /0\.00/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
