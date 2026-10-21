#!/usr/bin/env node
/* Copy performance UI regressions against deterministic Laravel API contracts.
   EDGE_JSDOM_PATH=/private/tmp/edge-dom-qa/node_modules/jsdom node scripts/check-copy-performance-ui.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require(process.env.EDGE_JSDOM_PATH || 'jsdom')); }
catch { console.error('Install jsdom outside the repository and set EDGE_JSDOM_PATH.'); process.exit(1); }
const root = path.resolve(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));
const tick = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };
const member = { id: 1, name: 'Copy Member', email: 'copy@example.test', is_admin: false, kyc_status: 'approved' };
const strategy = { id: 11, name: 'Touchline Method', slug: 'touchline', sport: 'football', description: 'Copies administrator picks.', risk: 'balanced', stake_percentage: 10, active: true, min_deposit_cents: 10000 };
const day = date => `2026-09-${String(date).padStart(2, '0')}T12:00:00.000Z`;
const deposit = (amount = 100000) => ({ id: 'deposit', type: 'deposit', recorded_at: day(1), value_cents: amount, change_cents: amount, label: 'Initial allocation', stake_id: null, status: 'deposit' });
const point = (id, status, date, value, change, label) => ({ id: `stake-${id}`, type: 'settlement', recorded_at: day(date), value_cents: value, change_cents: change, label, stake_id: id, status });
const game = (id, status, settled, stake, payout, changes = {}) => ({ id, home_name: `Home ${id}`, away_name: `Away ${id}`, status, stake_cents: stake, payout_cents: payout, net_change_cents: status === 'pending' ? null : payout - stake, settled_at: settled ? day(settled) : null, created_at: day(2), odds: '2.5000', outcome: 'home', event_id: 1000 + id, starts_at: day(20 - id), ...changes });
const initial = () => ({ id: 71, strategy_id: 11, strategy: clone(strategy), principal_cents: 100000, value_cents: 100000, equity_cents: 100000, reserved_cents: 0, profit_cents: 0, status: 'active', stake_percentage: 10, pending_stakes_count: 0, stakes: [], created_at: day(1), performance: { initial_deposit_cents: 100000, current_value_cents: 100000, net_profit_cents: 0, return_percentage: 0, settled_stakes_count: 0, points: [deposit()], games: [] } });
function mixed() {
  const p = initial();
  // Kickoff order intentionally differs from settlement order. Pending capital
  // remains owned; its 20,000 reservation is not a realized chart loss.
  const win = game(12, 'won', 4, 10000, 25000, { home_name: 'Lagos United', away_name: 'Abuja City', starts_at: day(12) });
  const loss = game(7, 'lost', 6, 12000, 0, { home_name: 'Kano Rangers', away_name: 'Ibadan Athletic', starts_at: day(3) });
  const refund = game(9, 'void', 8, 5000, 5000, { home_name: 'Enugu Stars', away_name: 'Benin FC', starts_at: day(5) });
  const pending = game(15, 'pending', null, 20000, 0, { home_name: 'Port Harcourt FC', away_name: 'Jos Wanderers', created_at: day(10), starts_at: day(11) });
  p.value_cents = 83000; p.equity_cents = 103000; p.reserved_cents = 20000; p.profit_cents = 3000; p.pending_stakes_count = 1;
  p.stakes = [pending, refund, loss, win];
  p.performance = { initial_deposit_cents: 100000, current_value_cents: 103000, net_profit_cents: 3000, return_percentage: 3, settled_stakes_count: 3, points: [deposit(), point(12, 'won', 4, 115000, 15000, 'Lagos United vs Abuja City'), point(7, 'lost', 6, 103000, -12000, 'Kano Rangers vs Ibadan Athletic'), point(9, 'void', 8, 103000, 0, 'Enugu Stars vs Benin FC')], games: [pending, refund, loss, win] };
  return p;
}
const account = positions => ({ user: clone(member), currency: 'USD', balance_cents: 500000, profit_cents: 0, active_stakes_cents: 0, potential_returns_cents: 0, bets: [], transactions: [], copy_positions: clone(positions), wallet_requests: [] });
let passed = 0, failed = 0;

async function setup(positions = [initial()], options = {}) {
  const errors = [], calls = [], intervals = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', error => errors.push(error.message));
  const html = fs.readFileSync(path.join(root, 'resources/views/app.blade.php'), 'utf8')
    .replace("{{ $serverMode ?? 'static' }}", 'laravel')
    .replace("@include('partials.admin')", fs.readFileSync(path.join(root, 'resources/views/partials/admin.blade.php'), 'utf8'))
    .replace("@include('partials.kyc')", fs.readFileSync(path.join(root, 'resources/views/partials/kyc.blade.php'), 'utf8'));
  const dom = new JSDOM(html, { url: 'http://localhost:8135/#copy', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  const backend = { state: account(positions), user: options.guest ? null : clone(member) };
  backend.state.user = backend.user;
  w.scrollTo = () => {};
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.setInterval = callback => { intervals.push(callback); return intervals.length; };
  w.fetch = async (url, opts = {}) => {
    const call = { path: url, method: opts.method || 'GET', headers: clone(opts.headers || {}), body: opts.body ? JSON.parse(opts.body) : null };
    calls.push(call);
    let data;
    if (url === '/api/session') data = { user: backend.user, csrf_token: 'copy-performance-csrf', currency: 'USD' };
    else if (url === '/api/payment-methods') data = { stripe: { enabled: false, mode: 'test' }, manual: { enabled: true } };
    else if (url === '/api/events') data = { events: [] };
    else if (url === '/api/copy/strategies') data = { strategies: [clone(strategy)] };
    else if (url === '/api/state') data = backend.state;
    else if (url === '/api/auth/logout') { backend.user = null; backend.state.user = null; data = { user: null, csrf_token: 'logout-token' }; }
    else if (url === '/api/copy/positions' && call.method === 'POST') {
      const p = initial(); p.id = 72; p.principal_cents = p.value_cents = p.equity_cents = call.body.amount_cents;
      p.performance = { initial_deposit_cents: call.body.amount_cents, current_value_cents: call.body.amount_cents, net_profit_cents: 0, return_percentage: 0, settled_stakes_count: 0, points: [deposit(call.body.amount_cents)], games: [] };
      backend.state.copy_positions.push(p); backend.state.balance_cents -= call.body.amount_cents; data = { position: p };
    } else if (/^\/api\/copy\/positions\/\d+$/.test(url) && call.method === 'PATCH') {
      const p = backend.state.copy_positions.find(position => position.id === Number(url.split('/').at(-1)));
      p.status = call.body.status; data = { position: p };
    } else throw new Error(`Unexpected mock API request: ${call.method} ${url}`);
    return { ok: true, status: 200, json: async () => clone(data) };
  };
  w.addEventListener('error', e => errors.push(e.error?.message || e.message));
  w.eval(fs.readFileSync(path.join(root, 'public/assets/app.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(root, 'public/assets/server-app.js'), 'utf8'));
  await tick();
  const $ = (selector, within = w.document) => { const el = within.querySelector(selector); assert.ok(el, `Missing ${selector}`); return el; };
  const $$ = (selector, within = w.document) => [...within.querySelectorAll(selector)];
  const card = id => $(`article[data-copy-position="${id}"]`);
  const points = id => $$(`button[data-copy-chart-point][data-copy-position="${id}"]`);
  const values = id => points(id).map(button => Number(button.dataset.pointValue));
  const click = async selector => { $(selector).click(); await tick(); };
  const input = (selector, value) => { $(selector).value = String(value); $(selector).dispatchEvent(new w.Event('input', { bubbles: true })); };
  const refresh = async () => { await w.EdgeAPI.refresh(); await tick(); };
  return { w, $, $$, card, points, values, click, input, refresh, backend, calls, errors, intervals, close: () => w.close() };
}

async function test(name, fn, positions, options) {
  let app;
  try { app = await setup(positions, options); await fn(app); assert.deepEqual(app.errors, [], 'Runtime errors'); console.log(`PASS ${name}`); passed++; }
  catch (error) { console.error(`FAIL ${name}: ${error.stack || error.message}`); failed++; }
  finally { app?.close(); }
}

(async () => {
  await test('New allocation starts at exactly the deposited amount before any game settles', async a => {
    assert.deepEqual(a.values(71), [100000]);
    assert.match(a.$('.copy-position-values', a.card(71)).textContent, /\$1,000\.00/);
    assert.match(a.$('[data-copy-chart-readout]', a.card(71)).textContent, /\$1,000\.00/);
    assert.match(a.$('.copy-equity-toolbar', a.card(71)).textContent, /YOUR CAPITAL \/ USD/);
    assert.ok(a.$$('.copy-equity-axis', a.card(71)).every(axis => axis.textContent.startsWith('$')));
    assert.ok(a.points(71).every(point => point.getAttribute('aria-label').includes('$')));
    assert.doesNotMatch(a.w.document.body.textContent, /₦|\bNGN\b|\bnaira\b/i);
    assert.equal(a.$$('.copy-master-games > li', a.card(71)).length, 0);
    assert.doesNotMatch(a.$('.copy-equity-chart', a.card(71)).innerHTML, /NaN|Infinity|undefined/);
  });
  await test('Funding through the existing API produces a chart from the new allocation', async a => {
    await a.click('[data-server-copy-fund="11"]'); a.input('#server-copy-amount', '1250.55');
    a.$('#server-copy-form').dispatchEvent(new a.w.Event('submit', { bubbles: true, cancelable: true })); await tick();
    assert.deepEqual(a.values(72), [125055]);
    assert.equal(a.calls.find(call => call.path === '/api/copy/positions').body.amount_cents, 125055);
    assert.match(a.$('[data-copy-chart-readout]', a.card(72)).textContent, /1,250\.55/);
  }, []);
  await test('Wins add net profit, losses subtract the stake, and a void keeps capital unchanged', async a => {
    assert.deepEqual(a.values(71), [100000, 115000, 103000, 103000]);
    assert.notEqual(a.values(71)[1], 125000, 'Gross payout must not be added as profit');
    assert.equal(a.values(71).at(-1), 103000);
    assert.match(a.$('.copy-position-values', a.card(71)).textContent, /1,030\.00/);
  }, [mixed()]);
  await test('The SVG line rises on a win, drops on a loss and stays level for a void', async a => {
    const dots = a.$$('circle.copy-equity-dot', a.card(71));
    assert.equal(dots.length, 4);
    const coordinates = dots.map(dot => [Number(dot.getAttribute('cx')), Number(dot.getAttribute('cy'))]);
    assert.ok(coordinates.every(point => point.every(Number.isFinite)), 'Chart geometry must be finite');
    assert.ok(coordinates[1][1] < coordinates[0][1], 'A win must rise visually');
    assert.ok(coordinates[2][1] > coordinates[1][1], 'A loss must fall visually');
    assert.equal(coordinates[2][1], coordinates[3][1], 'A void must retain the same height');
    assert.ok(coordinates.every((point, i) => i === 0 || point[0] > coordinates[i - 1][0]), 'Settlement time must advance from left to right');
    const segments = a.$('path.copy-equity-line', a.card(71)).getAttribute('d').match(/[ML][^ML]+/g);
    assert.equal(segments.length, 4);
    for (let i = 0; i < segments.length; i++) {
      const xy = segments[i].slice(1).trim().split(/[\s,]+/).map(Number);
      assert.deepEqual(xy, coordinates[i], 'The visible line must match the actual balance points');
    }
  }, [mixed()]);
  await test('Unsettled copied games stay in the history without reducing the equity curve', async a => {
    assert.equal(a.points(71).length, 4);
    assert.equal(a.values(71).includes(83000), false, 'Reserved stake is still owned capital');
    const row = a.$('[data-copy-game="15"]', a.card(71));
    assert.equal(row.dataset.status, 'pending'); assert.match(a.$('.copy-game-status', row).textContent, /pending/i);
    assert.doesNotMatch(a.$('.copy-game-change', row).textContent, /−|-/);
  }, [mixed()]);
  await test('Every copied game appears below the chart with team names and a clear result', async a => {
    const c = a.card(71), chart = a.$('[data-copy-performance="71"]', c), history = a.$('.copy-master-games', c);
    assert.ok(chart.compareDocumentPosition(history) & a.w.Node.DOCUMENT_POSITION_FOLLOWING);
    for (const [id, names, status] of [[12, ['Lagos United', 'Abuja City'], /won/i], [7, ['Kano Rangers', 'Ibadan Athletic'], /lost/i], [9, ['Enugu Stars', 'Benin FC'], /void|refund/i]]) {
      const row = a.$(`[data-copy-game="${id}"]`, history);
      names.forEach(name => assert.ok(a.$('.copy-game-teams', row).textContent.includes(name)));
      assert.match(a.$('.copy-game-status', row).textContent, status);
    }
    assert.match(a.$('[data-copy-game="12"] .copy-game-change', c).textContent, /\+\$150\.00/);
    assert.match(a.$('[data-copy-game="7"] .copy-game-change', c).textContent, /−\$120\.00/);
  }, [mixed()]);
  await test('The curve follows settlement chronology while the game list shows newest activity first', async a => {
    const labels = a.points(71).map(button => button.getAttribute('aria-label'));
    assert.match(labels[1], /Lagos United/); assert.match(labels[2], /Kano Rangers/); assert.match(labels[3], /Enugu Stars/);
    assert.deepEqual(a.$$('.copy-master-games > li', a.card(71)).map(row => Number(row.dataset.copyGame)), [15, 9, 7, 12]);
  }, [mixed()]);
  await test('Chart point click selects an actual balance and exposes the settled game', async a => {
    a.points(71)[1].click(); await tick();
    const readout = a.$('[data-copy-chart-readout]', a.card(71));
    assert.match(readout.textContent, /1,150\.00/); assert.match(readout.textContent, /Lagos United/);
    assert.equal(a.points(71)[1].getAttribute('aria-pressed'), 'true');
    assert.equal(a.points(71).filter(point => point.getAttribute('aria-pressed') === 'true').length, 1);
  }, [mixed()]);
  await test('Chart points support focus, arrows, Home and End without leaving the position', async a => {
    let pointButton = a.points(71)[2]; pointButton.focus(); await tick();
    assert.match(a.$('[data-copy-chart-readout]', a.card(71)).textContent, /Kano Rangers/);
    pointButton.dispatchEvent(new a.w.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })); await tick();
    assert.match(a.$('[data-copy-chart-readout]', a.card(71)).textContent, /Lagos United/);
    a.w.document.activeElement.dispatchEvent(new a.w.KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true })); await tick();
    assert.equal(a.w.document.activeElement.dataset.copyChartPoint, '0');
    a.w.document.activeElement.dispatchEvent(new a.w.KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true })); await tick();
    assert.equal(a.w.document.activeElement.dataset.copyChartPoint, '3');
    a.w.document.activeElement.dispatchEvent(new a.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })); await tick();
    assert.equal(a.w.document.activeElement.dataset.copyPosition, '71');
  }, [mixed()]);
  await test('Pointer movement exposes a real point without changing wallet balances', async a => {
    const before = a.$('[data-balance]').textContent;
    a.points(71)[2].dispatchEvent(new a.w.MouseEvent('pointerover', { bubbles: true })); await tick();
    assert.match(a.$('[data-copy-chart-readout]', a.card(71)).textContent, /Kano Rangers/);
    assert.equal(a.$('[data-balance]').textContent, before); assert.equal(a.calls.filter(call => call.method !== 'GET').length, 0);
  }, [mixed()]);
  await test('The complete game history is retained beyond the old four-game preview', async a => {
    assert.equal(a.$$('.copy-master-games > li', a.card(71)).length, 6);
    assert.match(a.$('.copy-master-games', a.card(71)).textContent, /Home 26/);
  }, (() => { const p = initial(); p.performance.games = Array.from({ length: 6 }, (_, i) => game(21 + i, 'pending', null, 1000, 0)); p.stakes = clone(p.performance.games); p.pending_stakes_count = 6; return [p]; })());
  await test('A fully lost allocation renders a finite curve ending at zero', async a => {
    assert.deepEqual(a.values(71), [100000, 0]);
    assert.doesNotMatch(a.$('.copy-equity-chart', a.card(71)).innerHTML, /NaN|Infinity|undefined/);
    a.points(71).at(-1).click(); await tick();
    assert.match(a.$('[data-copy-chart-readout]', a.card(71)).textContent, /0\.00/);
  }, (() => { const p = initial(); const g = game(1, 'lost', 2, 100000, 0); p.value_cents = p.equity_cents = 0; p.profit_cents = -100000; p.stakes = [g]; p.performance = { initial_deposit_cents: 100000, current_value_cents: 0, net_profit_cents: -100000, return_percentage: -100, settled_stakes_count: 1, points: [deposit(), point(1, 'lost', 2, 0, -100000, 'Home 1 vs Away 1')], games: [g] }; return [p]; })());
  await test('Paused positions keep their performance and resume using the existing API', async a => {
    assert.deepEqual(a.values(71), [100000, 115000, 103000, 103000]);
    assert.match(a.$('[data-server-copy-status="71"]').textContent, /resume/i);
    await a.click('[data-server-copy-status="71"]');
    assert.equal(a.calls.find(call => call.method === 'PATCH').body.status, 'active');
    assert.deepEqual(a.values(71), [100000, 115000, 103000, 103000]);
    assert.match(a.$('[data-server-copy-status="71"]').textContent, /pause/i);
  }, (() => { const p = mixed(); p.status = 'paused'; return [p]; })());
  await test('Closed positions retain their final historical capital after funds return to the wallet', async a => {
    assert.equal(a.w.document.querySelector('article[data-copy-position="71"]'), null);
    await a.click('[data-copy-position-filter="all"]');
    assert.deepEqual(a.values(71), [100000, 115000, 103000, 103000]);
    assert.match(a.$('.copy-position-values', a.card(71)).textContent, /1,030\.00/);
    assert.equal(a.w.document.querySelector('[data-server-copy-status="71"]'), null);
    assert.equal(a.w.document.querySelector('[data-server-copy-close="71"]'), null);
    assert.match(a.$('#copy-total-allocated').textContent, /0\.00/);
  }, (() => { const p = mixed(); p.status = 'closed'; p.value_cents = p.equity_cents = p.reserved_cents = 0; p.pending_stakes_count = 0; p.stakes = p.stakes.filter(g => g.status !== 'pending'); p.performance.games = p.performance.games.filter(g => g.status !== 'pending'); return [p]; })());
  await test('Multiple allocations have separate chart values and point selections', async a => {
    assert.deepEqual(a.values(71), [100000, 115000, 103000, 103000]); assert.deepEqual(a.values(88), [300000, 330000]);
    const secondBefore = a.$('[data-copy-chart-readout]', a.card(88)).textContent;
    a.points(71)[1].click(); await tick();
    assert.match(a.$('[data-copy-chart-readout]', a.card(71)).textContent, /1,150\.00/);
    assert.equal(a.$('[data-copy-chart-readout]', a.card(88)).textContent, secondBefore);
    a.points(88)[0].focus(); a.points(88)[0].dispatchEvent(new a.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })); await tick();
    assert.equal(a.w.document.activeElement.dataset.copyPosition, '88');
    assert.match(a.$('[data-copy-chart-readout]', a.card(88)).textContent, /3,300\.00/);
  }, (() => { const p = initial(); p.id = 88; p.principal_cents = 300000; p.value_cents = p.equity_cents = 330000; p.profit_cents = 30000; const g = game(99, 'won', 4, 60000, 90000, { home_name: 'Second Master Home', away_name: 'Second Master Away' }); p.stakes = [g]; p.performance = { initial_deposit_cents: 300000, current_value_cents: 330000, net_profit_cents: 30000, return_percentage: 10, settled_stakes_count: 1, points: [deposit(300000), point(99, 'won', 4, 330000, 30000, 'Second Master Home vs Second Master Away')], games: [g] }; return [mixed(), p]; })());
  await test('Server refresh replaces the curve with newly settled values without optimistic changes', async a => {
    assert.deepEqual(a.values(71), [100000]);
    a.backend.state.copy_positions = [mixed()]; await a.refresh();
    assert.deepEqual(a.values(71), [100000, 115000, 103000, 103000]);
    assert.match(a.$('.copy-master-games', a.card(71)).textContent, /Lagos United/);
  });
  await test('Team names and point labels are escaped in SVG, accessible controls and history', async a => {
    assert.equal(a.card(71).querySelector('img,script,iframe'), null);
    assert.match(a.$('.copy-game-teams', a.card(71)).textContent, /<img src=x onerror=/);
    a.points(71)[1].click(); await tick();
    assert.match(a.$('[data-copy-chart-readout]', a.card(71)).textContent, /<img src=x onerror=/);
    assert.equal(a.w.copyChartXSS, undefined);
  }, (() => { const p = initial(); const name = '<img src=x onerror="window.copyChartXSS=1">'; const g = game(4, 'won', 3, 10000, 20000, { home_name: name, away_name: '"quoted" & <script>unsafe</script>' }); p.value_cents = p.equity_cents = 110000; p.profit_cents = 10000; p.stakes = [g]; p.performance = { initial_deposit_cents: 100000, current_value_cents: 110000, net_profit_cents: 10000, return_percentage: 10, settled_stakes_count: 1, points: [deposit(), point(4, 'won', 3, 110000, 10000, `${g.home_name} vs ${g.away_name}`)], games: [g] }; return [p]; })());
  await test('Signing out removes the private chart and master game history', async a => {
    assert.equal(a.points(71).length, 4); await a.click('#profile-button'); await a.click('#server-logout');
    assert.equal(a.w.document.querySelector('[data-copy-performance]'), null);
    assert.doesNotMatch(a.$('#copy-position-list').textContent, /Lagos United|1,030\.00/);
  }, [mixed()]);
  await test('Guests see no fictional position chart or performance balance', async a => {
    assert.equal(a.w.document.querySelector('[data-copy-performance]'), null);
    assert.match(a.$('#copy-total-allocated').textContent, /0\.00/);
    assert.equal(a.calls.filter(call => call.path === '/api/state').length, 0);
  }, [mixed()], { guest: true });
  console.log(`${passed} copy performance UI checks passed; ${failed} failed.`);
  if (failed) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
