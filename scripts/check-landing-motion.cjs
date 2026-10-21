#!/usr/bin/env node
/* Bounded DOM checks for the landing page, data-driven loader and request feedback.
   EDGE_JSDOM_PATH=/private/tmp/edge-dom-qa/node_modules/jsdom node scripts/check-landing-motion.cjs */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require(process.env.EDGE_JSDOM_PATH || 'jsdom')); }
catch { console.error('Install jsdom outside the repository and set EDGE_JSDOM_PATH.'); process.exit(1); }
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const tick = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
const member = { id: 1, name: 'Test Member', email: 'member@example.test', is_admin: false, kyc_status: 'approved' };
let passed = 0, failed = 0;

const marketingMarkup = JSON.parse(execFileSync('php', [path.join(root,'scripts/render-marketing.php')], {cwd:root,encoding:'utf8',maxBuffer:4*1024*1024}));
function markup(kind) {
  if(kind==='landing')return marketingMarkup['/'];
  return read(`resources/views/${kind === 'landing' ? 'landing' : 'app'}.blade.php`)
    .replace("{{ $serverMode ?? 'static' }}", 'laravel')
    .replace("@include('partials.admin')", read('resources/views/partials/admin.blade.php'))
    .replace("@include('partials.kyc')", read('resources/views/partials/kyc.blade.php'));
}

async function setup(kind = 'app', options = {}) {
  const errors = [], calls = [], intervals = [], timers = [], pending = [], failures = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(markup(kind), { url: `http://localhost:8135/${kind === 'landing' ? '' : 'app'}${options.suffix || ''}`, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  let user = options.member ? { ...member } : null;
  let heldPath = options.holdPath;
  let timerId = 1000000;
  w.scrollTo = () => {};
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.matchMedia = query => ({ matches: !!options.reduced && query.includes('prefers-reduced-motion'), media: query, addEventListener() {}, removeEventListener() {} });
  w.setInterval = callback => { intervals.push(callback); return intervals.length; };
  const nativeTimeout = w.setTimeout.bind(w), nativeClear = w.clearTimeout.bind(w);
  w.setTimeout = (callback, delay = 0, ...args) => {
    if (delay < 1000) return nativeTimeout(callback, delay, ...args);
    const timer = { id: ++timerId, delay, callback: () => callback(...args), cleared: false };
    timers.push(timer); return timer.id;
  };
  w.clearTimeout = id => { const timer = timers.find(t => t.id === id); if (timer) timer.cleared = true; else nativeClear(id); };
  const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
  const dataFor = (url, body) => {
    if (url === '/api/session') return { user, csrf_token: 'csrf-test', currency: 'USD' };
    if (url === '/api/events') return { events: options.events || [] };
    if (url === '/api/copy/strategies') return { strategies: [] };
    if (url === '/api/payment-methods') return { stripe: { enabled: false, mode: 'test' }, manual: { enabled: true } };
    if (url === '/api/state') return { user, balance_cents: options.balance_cents || 0, profit_cents: 0, active_stakes_cents: 0, potential_returns_cents: 0, bets: [], transactions: [], copy_positions: [], wallet_requests: [] };
    if (url === '/api/auth/login' || url === '/api/auth/register') { user = { ...member, name: body?.name || member.name, email: body.email }; return { user, csrf_token: 'csrf-rotated', currency: 'USD' }; }
    throw new Error(`Unexpected request ${url}`);
  };
  w.fetch = async (url, request = {}) => {
    const body = request.body ? JSON.parse(request.body) : null;
    calls.push({ url, method: request.method || 'GET', body });
    if (heldPath === url) return new Promise(resolve => pending.push({ url, body, resolve }));
    const failureIndex = failures.findIndex(f => f.url === url);
    if (failureIndex !== -1) { const failure = failures.splice(failureIndex, 1)[0]; return response(failure.data, failure.status); }
    if (options.failPath === url) return response({ message: 'Service unavailable.' }, 503);
    return response(dataFor(url, body));
  };
  w.addEventListener('error', event => errors.push(event.error?.message || event.message));
  if (options.scripts !== false) {
    const scripts = [...w.document.querySelectorAll('script[src]')]
      .map(script => script.getAttribute('src')).filter(src => src.startsWith('/assets/') && src !== '/assets/admin.js');
    for (const src of scripts) w.eval(read(`public${src}`));
  }
  await tick();
  const $ = selector => { const element = w.document.querySelector(selector); assert.ok(element, `Missing ${selector}`); return element; };
  return {
    w, $, calls, intervals, timers, errors,
    failNext: (url, status = 422, data = { message: 'Please try again.' }) => failures.push({ url, status, data }),
    hold: url => { heldPath = url; },
    release: async (url, status = 200, data) => { heldPath = null; const item = pending.find(p => p.url === url); assert.ok(item, `No pending ${url}`); pending.splice(pending.indexOf(item), 1); item.resolve(response(data ?? dataFor(url, item.body), status)); await tick(); },
    click: async selector => { $(selector).click(); await tick(); },
    submit: async selector => { $(selector).dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await tick(); },
    input: (selector, value) => { $(selector).value = value; $(selector).dispatchEvent(new w.Event('input', { bubbles: true })); },
    close: () => w.close(),
  };
}

async function test(name, kind, options, fn) {
  let app;
  try { app = await setup(kind, options); await fn(app); assert.deepEqual(app.errors, [], 'Runtime errors'); console.log(`PASS ${name}`); passed++; }
  catch (error) { console.error(`FAIL ${name}: ${error.message}`); failed++; }
  finally { app?.close(); }
}

// Feature assertions are below so the same harness exercises both page entry points.
(async () => {
  await test('Landing page remains readable and navigable without JavaScript', 'landing', { scripts: false }, async a => {
    assert.ok(a.$('h1').textContent.trim());
    assert.ok(a.$('main'));
    assert.ok(a.$('a[href="/app#sports"]'));
    assert.ok(a.$('a[href^="/app?auth=register"]'));
    assert.ok(a.$('a[href^="/app?auth=login"]'));
    assert.ok(a.$('details summary').textContent.trim());
    assert.equal(a.$('#edge-page-loader').hidden, true);
    assert.equal(a.$('body').dataset.edgeLoading, undefined);
    assert.equal(a.$('.landing-menu-toggle').hidden, true);
    assert.equal(a.$('#landing-navigation').hidden, false);
    const question = a.$('details');
    a.$('details summary').click(); await tick();
    assert.equal(question.open, true, 'Native FAQ opens without a script');
  });

  await test('Every local landing image, stylesheet and script exists', 'landing', { scripts: false }, async a => {
    for (const element of a.w.document.querySelectorAll('img[src], script[src], link[rel="stylesheet"][href]')) {
      const asset = element.getAttribute('src') || element.getAttribute('href');
      if (asset.startsWith('/assets/')) assert.ok(fs.existsSync(path.join(root, 'public', asset)), `Missing asset ${asset}`);
    }
    for (const anchor of a.w.document.querySelectorAll('a[href^="#"]')) {
      const hash = anchor.getAttribute('href').slice(1);
      if (hash) assert.ok(a.w.document.getElementById(hash), `Broken anchor #${hash}`);
    }
  });

  await test('The hidden loader stays visually hidden before JavaScript and after completion', 'landing', { scripts: false }, async a => {
    const stylesheet = a.w.document.createElement('style'); stylesheet.textContent = read('public/assets/motion.css'); a.w.document.head.append(stylesheet);
    const loader = a.$('#edge-page-loader');
    assert.equal(loader.hidden, true);
    assert.equal(a.w.getComputedStyle(loader).display, 'none', 'Loader styles must honor the hidden attribute');
    loader.hidden = false;
    assert.equal(a.w.getComputedStyle(loader).display, 'grid');
    loader.hidden = true;
    assert.equal(a.w.getComputedStyle(loader).display, 'none');
  });

  await test('Landing loader completes on document readiness with no artificial waiting', 'landing', {}, async a => {
    assert.equal(a.$('#edge-page-loader').hidden, true);
    assert.notEqual(a.$('body').dataset.edgeLoading, 'true');
    assert.equal(a.calls.length, 0);
    assert.ok(a.w.EdgeMotion);
  });

  await test('Mobile landing navigation opens and closes through links, Escape and outside clicks', 'landing', {}, async a => {
    const toggle = a.$('.landing-menu-toggle'), nav = a.$('#landing-navigation');
    assert.equal(toggle.hidden, false);
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    await a.click('.landing-menu-toggle');
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(nav.classList.contains('is-open'), true);
    // jsdom does not navigate between documents; the href itself is checked below.
    a.$('#landing-navigation a[href="/copy-staking"]').addEventListener('click', event => event.preventDefault(), {once:true});
    await a.click('#landing-navigation a[href="/copy-staking"]');
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(nav.classList.contains('is-open'), false);
    await a.click('.landing-menu-toggle');
    a.w.document.dispatchEvent(new a.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await tick();
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(a.w.document.activeElement, toggle);
    await a.click('.landing-menu-toggle');
    await a.click('h1');
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  });

  await test('Illustrative copy chart links deposits and game results with accessible selected states', 'landing', {}, async a => {
    assert.match(a.$('.copy-preview').textContent, /illustrative|example/i);
    assert.match(a.$('.copy-preview').textContent, /EXAMPLE CAPITAL \/ USD/);
    assert.doesNotMatch(a.w.document.body.textContent, /₦|\bNGN\b|\bnaira\b/i);
    for (const point of a.w.document.querySelectorAll('[data-preview-point]')) assert.match(point.getAttribute('aria-label'), /dollars|USD/i);
    await a.click('[data-preview-game="2"]');
    assert.match(a.$('#preview-capital').textContent, /\$20,600/);
    assert.equal(a.$('#preview-change').textContent, '−$1,000.00');
    assert.match(a.$('#preview-event').textContent, /Harbour FC.*Athletic Town.*Lost/);
    assert.equal(a.$('[data-preview-point="2"]').getAttribute('aria-pressed'), 'true');
    assert.equal(a.$('[data-preview-game="2"]').getAttribute('aria-pressed'), 'true');
    assert.match(a.$('#preview-announcement').textContent, /Example capital.*20,600/);
    await a.click('[data-preview-point="0"]');
    assert.match(a.$('#preview-capital').textContent, /\$20,000/);
    assert.match(a.$('#preview-event').textContent, /Initial deposit/);
    assert.equal(a.$('[data-preview-point="0"]').getAttribute('aria-pressed'), 'true');
    assert.equal(a.$('[data-preview-point="2"]').getAttribute('aria-pressed'), 'false');
  });

  await test('Legacy app bookmarks redirect to the platform while preserving query and hash', 'landing', {}, async () => {
    for (const [source, expected] of [
      ['http://localhost:8135/?source=bookmark#copy', '/app?source=bookmark#copy'],
      ['http://localhost:8135/#admin', '/app#admin'],
      ['http://localhost:8135/?stripe_return=cancel&payment_ref=ref-123', '/app?stripe_return=cancel&payment_ref=ref-123#wallet'],
    ]) {
      let destination;
      vm.runInNewContext(read('public/assets/landing.js'), { URL, window: { location: { href: source, replace: value => { destination = value; } } }, document: {} });
      assert.equal(destination, `http://localhost:8135${expected}`);
    }
  });

  await test('App preloader waits for real initial API data, then releases immediately', 'app', { holdPath: '/api/events' }, async a => {
    assert.equal(a.$('#edge-page-loader').hidden, false);
    assert.equal(a.$('body').dataset.edgeLoading, 'true');
    assert.equal(a.$('#app-shell').getAttribute('aria-busy'), 'true');
    await a.release('/api/events');
    assert.equal(a.$('#edge-page-loader').hidden, true);
    assert.equal(a.$('#app-shell').getAttribute('aria-busy'), 'false');
    assert.notEqual(a.$('body').dataset.edgeLoading, 'true');
  });

  await test('An initial API error releases the preloader and leaves retryable controls', 'app', { failPath: '/api/events' }, async a => {
    assert.equal(a.$('#edge-page-loader').hidden, true);
    assert.equal(a.$('#app-shell').getAttribute('aria-busy'), 'false');
    assert.match(a.$('#toast').textContent, /Could not connect|unavailable/i);
    a.w.EdgeAPI.openAuth(); await tick();
    assert.equal(a.$('#auth-form').dataset.mode, 'login');
    assert.equal(a.$('#auth-form button[type="submit"]').disabled, false);
  });

  await test('Loader fail-safe releases a stalled initialization without manufacturing account data', 'app', { holdPath: '/api/events' }, async a => {
    const timeout = a.timers.find(timer => !timer.cleared && timer.delay === 12000);
    assert.ok(timeout, 'A bounded initialization fail-safe is required');
    timeout.callback(); await tick();
    assert.equal(a.$('#edge-page-loader').hidden, true);
    assert.equal(a.$('#app-shell').getAttribute('aria-busy'), 'false');
    assert.equal(a.w.EdgeAPI.user, null);
    assert.match(a.$('[data-balance]').textContent, /0\.00/);
    await a.release('/api/events');
    assert.equal(a.$('#edge-page-loader').hidden, true);
  });

  await test('Background account refreshes never flash the full-page loader', 'app', {}, async a => {
    a.hold('/api/events');
    const update = a.w.EdgeAPI.refresh(); await tick();
    assert.equal(a.$('#edge-page-loader').hidden, true);
    assert.equal(a.$('#app-shell').getAttribute('aria-busy'), 'false');
    await a.release('/api/events'); await update;
    assert.equal(a.$('#edge-page-loader').hidden, true);
  });

  for (const mode of ['login', 'register']) await test(`Landing ${mode} CTA opens the guest form and preserves other return parameters`, 'app', { suffix: `?auth=${mode}&stripe_return=success&payment_ref=reference-123#wallet` }, async a => {
    assert.equal(a.$('#auth-form').dataset.mode, mode);
    const url = new URL(a.w.location.href);
    assert.equal(url.searchParams.has('auth'), false);
    assert.equal(url.searchParams.get('stripe_return'), 'success');
    assert.equal(url.searchParams.get('payment_ref'), 'reference-123');
    assert.equal(url.hash, '#wallet');
  });

  await test('An existing member follows the app CTA without an unnecessary authentication modal', 'app', { member: true, suffix: '?auth=register#copy' }, async a => {
    assert.equal(a.w.EdgeAPI.user.id, member.id);
    assert.equal(a.w.document.querySelector('#auth-form'), null);
    assert.equal(a.$('#info-modal').hidden, true);
    assert.equal(a.w.location.hash, '#copy');
  });

  await test('Authentication shows accessible busy feedback, blocks duplicate submission and restores after errors', 'app', { suffix: '?auth=login' }, async a => {
    a.input('#auth-email', member.email); a.input('#auth-password', 'Password123456');
    const button = a.$('#auth-form button[type="submit"]'), label = button.textContent;
    a.hold('/api/auth/login');
    await a.submit('#auth-form');
    assert.equal(button.disabled, true);
    assert.equal(button.getAttribute('aria-busy'), 'true');
    assert.ok(button.querySelector('.edge-button-spinner'));
    await a.submit('#auth-form');
    assert.equal(a.calls.filter(call => call.url === '/api/auth/login').length, 1);
    await a.release('/api/auth/login', 422, { message: 'Credentials could not be verified.' });
    assert.equal(button.disabled, false);
    assert.notEqual(button.getAttribute('aria-busy'), 'true');
    assert.equal(button.textContent, label);
    assert.equal(button.querySelector('.edge-button-spinner'), null);
    assert.match(a.$('#auth-error').textContent, /Credentials/);
  });

  await test('Background polling preserves busy stake feedback and restores the form after rejection', 'app', {
    member: true, balance_cents: 100000,
    events: [{ id: 41, sport: 'football', country: 'Test', league: 'Test League', home_name: 'Northside FC', away_name: 'Riverside FC', status: 'open', starts_at: new Date(Date.now() + 86400000).toISOString(), odds_home: '2.0000', odds_draw: '3.0000', odds_away: '2.5000', version: 1 }],
  }, async a => {
    await a.click('[data-server-odds="41"][data-outcome="home"]');
    a.input('#server-stake', '10');
    const form = a.$('#server-stake-form'), button = form.querySelector('[type="submit"]');
    a.hold('/api/bets'); await a.submit('#server-stake-form');
    assert.equal(button.disabled, true);
    assert.ok(button.querySelector('.edge-button-spinner'));
    await a.w.EdgeAPI.refresh(); await tick();
    assert.equal(a.$('#server-stake-form'), form, 'Polling must preserve an in-flight form');
    assert.equal(a.$('#server-stake').disabled, true);
    assert.ok(a.$('#server-stake-form .edge-button-spinner'));
    await a.release('/api/bets', 422, { message: 'Game odds changed. Review your selection.' });
    assert.equal(button.disabled, false);
    assert.equal(a.$('#server-stake').disabled, false);
    assert.equal(a.$('#server-stake').value, '10');
    assert.match(a.$('#server-slip-error').textContent, /odds changed/);
  });

  await test('Busy feedback release is idempotent and preserves a previously disabled control', 'app', {}, async a => {
    const button = a.w.document.createElement('button'); button.disabled = true; button.innerHTML = '<span>Original action</span>'; a.w.document.body.append(button);
    const release = a.w.EdgeMotion.busy(button, 'Working');
    assert.equal(button.getAttribute('aria-busy'), 'true');
    release(); release();
    assert.equal(button.disabled, true);
    assert.equal(button.innerHTML, '<span>Original action</span>');
    assert.notEqual(button.getAttribute('aria-busy'), 'true');
  });

  await test('Mutation progress remains visible until every pending request releases it', 'app', {}, async a => {
    const first = a.w.EdgeMotion.network(), second = a.w.EdgeMotion.network();
    const status = a.$('.edge-request-status');
    assert.equal(status.hidden, false);
    assert.equal(status.getAttribute('role'), 'status');
    first(); first();
    assert.equal(status.hidden, false);
    second();
    assert.equal(status.hidden, true);
  });

  await test('Reduced motion keeps all reveal content visible and the application usable', 'landing', { reduced: true }, async a => {
    const styles = read('public/assets/motion.css');
    assert.match(styles, /prefers-reduced-motion\s*:\s*reduce/);
    assert.match(styles, /animation[^;{}]*:\s*none|animation-duration\s*:\s*0/);
    assert.match(styles, /transition[^;{}]*:\s*none|transition-duration\s*:\s*0/);
    assert.equal(a.$('#edge-page-loader').hidden, true);
    assert.ok(a.$('h1').textContent.trim());
  });

  console.log(`\n${passed} landing and motion checks passed; ${failed} failed.`);
  if (failed) process.exitCode = 1;
})();
