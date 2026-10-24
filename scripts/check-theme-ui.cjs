#!/usr/bin/env node
/* Run with EDGE_JSDOM_PATH pointing at an external jsdom installation. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let JSDOM;
try { ({ JSDOM } = require(process.env.EDGE_JSDOM_PATH || 'jsdom')); }
catch { console.error('Set EDGE_JSDOM_PATH to an installed jsdom module.'); process.exit(1); }
const script = fs.readFileSync(path.join(__dirname, '../public/assets/theme.js'), 'utf8');
let passed = 0;

function setup({ saved, dark = false, blockedStorage = false, media = 'modern', lateButton = false } = {}) {
  const dom = new JSDOM('<!doctype html><html><head><meta name="theme-color" content="#111310"></head><body></body></html>', { url: 'https://edge.test/app', runScripts: 'outside-only' });
  const w = dom.window;
  const errors = [];
  w.addEventListener('error', event => errors.push(event.error));
  let changed;
  const query = { matches: dark };
  if (media === 'legacy') query.addListener = listener => { changed = listener; };
  else query.addEventListener = (type, listener) => { assert.equal(type, 'change'); changed = listener; };
  if (media === 'throws') w.matchMedia = () => { throw new Error('Media access denied'); };
  else if (media !== 'missing') w.matchMedia = () => query;
  if (saved !== undefined) w.localStorage.setItem('edge-theme', saved);
  if (blockedStorage) Object.defineProperty(w, 'localStorage', { get() { throw new Error('Storage access denied'); } });
  function addButton() {
    w.document.body.innerHTML = '<button type="button" data-theme-toggle><svg><path></path></svg></button><button type="button" data-theme-toggle></button>';
  }
  if (!lateButton) addButton();
  w.eval(script);
  return {
    w,
    errors,
    theme: () => w.document.documentElement.getAttribute('data-theme'),
    button: () => w.document.querySelector('[data-theme-toggle]'),
    addButton,
    ready() { w.document.dispatchEvent(new w.Event('DOMContentLoaded')); },
    system(value) { query.matches = value; if (changed) changed({ matches: value }); },
    click() { w.document.querySelector('[data-theme-toggle] path').dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true })); },
    close() { dom.window.close(); },
  };
}

function test(name, options, fn) {
  let a;
  try {
    a = setup(options);
    fn(a);
    assert.deepEqual(a.errors, [], 'No runtime errors');
    console.log(`PASS ${name}`);
    passed++;
  } finally { a?.close(); }
}

test('Saved dark preference applies immediately and overrides a light system', { saved: 'dark' }, a => {
  assert.equal(a.theme(), 'dark');
  assert.equal(a.button().getAttribute('aria-pressed'), 'true');
  assert.equal(a.button().getAttribute('aria-label'), 'Switch to light mode');
  assert.equal(a.w.document.querySelector('meta[name="theme-color"]').content, '#111611');
  a.system(false);
  assert.equal(a.theme(), 'dark');
});

test('System appearance follows changes until a manual choice', { dark: true }, a => {
  assert.equal(a.theme(), 'dark');
  a.system(false);
  assert.equal(a.theme(), 'light');
  a.click();
  assert.equal(a.theme(), 'dark');
  assert.equal(a.w.localStorage.getItem('edge-theme'), 'dark');
  a.system(true);
  a.system(false);
  assert.equal(a.theme(), 'dark');
});

test('Saved light is honored even when the system is dark', { saved: 'light', dark: true }, a => {
  assert.equal(a.theme(), 'light');
  assert.equal(a.button().getAttribute('aria-pressed'), 'false');
  assert.equal(a.button().title, 'Switch to dark mode');
  a.click();
  a.click();
  assert.equal(a.theme(), 'light');
  assert.equal(a.w.document.querySelector('meta[name="theme-color"]').content, '#f5f5f1');
});

test('Invalid stored preferences fall back to the current system', { saved: 'unexpected', dark: true }, a => {
  assert.equal(a.theme(), 'dark');
  a.system(false);
  assert.equal(a.theme(), 'light');
});

test('Buttons parsed after the head script receive accessible state', { lateButton: true, dark: true }, a => {
  assert.equal(a.theme(), 'dark');
  a.addButton();
  a.ready();
  for (const button of a.w.document.querySelectorAll('[data-theme-toggle]')) {
    assert.equal(button.getAttribute('aria-label'), 'Switch to light mode');
    assert.equal(button.getAttribute('aria-pressed'), 'true');
  }
  a.click();
  for (const button of a.w.document.querySelectorAll('[data-theme-toggle]')) {
    assert.equal(button.getAttribute('aria-label'), 'Switch to dark mode');
    assert.equal(button.getAttribute('aria-pressed'), 'false');
  }
});

test('Blocked storage leaves toggles and system changes functional', { blockedStorage: true, dark: true }, a => {
  a.system(false);
  assert.equal(a.theme(), 'light');
  a.click();
  assert.equal(a.theme(), 'dark');
  a.system(false);
  assert.equal(a.theme(), 'dark');
});

for (const media of ['missing', 'throws']) {
  test(`Unavailable media queries (${media}) safely default to light`, { media }, a => {
    assert.equal(a.theme(), 'light');
    a.click();
    assert.equal(a.theme(), 'dark');
  });
}

test('Legacy media listeners track system changes', { media: 'legacy' }, a => {
  a.system(true);
  assert.equal(a.theme(), 'dark');
});

test('Cross-tab choices sync and clearing preferences restores the system', { dark: true }, a => {
  a.w.dispatchEvent(new a.w.StorageEvent('storage', { key: 'edge-theme', newValue: 'light' }));
  assert.equal(a.theme(), 'light');
  a.system(true);
  assert.equal(a.theme(), 'light');
  a.w.dispatchEvent(new a.w.StorageEvent('storage', { key: 'another-key', newValue: 'dark' }));
  assert.equal(a.theme(), 'light');
  a.w.dispatchEvent(new a.w.StorageEvent('storage', { key: 'edge-theme', newValue: null }));
  assert.equal(a.theme(), 'dark');
  a.system(false);
  assert.equal(a.theme(), 'light');
});

test('Dark wallet ink, deposit contrast and action icons remain readable', { dark: true }, a => {
  const sheet = a.w.document.createElement('style');
  sheet.textContent = ['app.css', 'transfers.css', 'theme.css'].map(file => fs.readFileSync(path.join(__dirname, '../public/assets', file), 'utf8')).join('\n');
  a.w.document.head.append(sheet);
  a.w.document.body.innerHTML = '<aside class="wallet-card wallet-card-primary"><div class="wallet-actions"><button class="button green">Deposit</button></div></aside><button class="theme-toggle icon-button"><svg class="theme-icon-sun"></svg><svg class="theme-icon-moon"></svg></button>';
  const style = selector => a.w.getComputedStyle(a.w.document.querySelector(selector));
  assert.equal(style('.wallet-card-primary').color, 'rgb(21, 23, 20)');
  assert.equal(style('.wallet-actions .green').backgroundColor, 'rgb(21, 23, 20)');
  assert.equal(style('.wallet-actions .green').color, 'rgb(255, 255, 255)');
  assert.equal(style('.theme-icon-sun').display, 'block');
  assert.equal(style('.theme-icon-moon').display, 'none');
  a.system(false);
  assert.equal(style('.theme-icon-sun').display, 'none');
  assert.notEqual(style('.theme-icon-moon').display, 'none');
});

console.log(`\n${passed} theme behavior checks passed.`);
