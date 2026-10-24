(function () {
  'use strict';

  var root = document.documentElement;
  var key = 'edge-theme';
  var preference = null;
  var system = null;

  function validTheme(value) {
    return value === 'light' || value === 'dark';
  }

  try {
    var saved = window.localStorage.getItem(key);
    if (validTheme(saved)) preference = saved;
  } catch (error) { /* Theme switching also works when storage is unavailable. */ }

  try {
    if (typeof window.matchMedia === 'function') system = window.matchMedia('(prefers-color-scheme: dark)');
  } catch (error) { /* Older browsers start in light mode. */ }

  function systemTheme() {
    return system && system.matches ? 'dark' : 'light';
  }

  function syncControls() {
    var dark = root.getAttribute('data-theme') === 'dark';
    var label = dark ? 'Switch to light mode' : 'Switch to dark mode';
    document.querySelectorAll('[data-theme-toggle]').forEach(function (button) {
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
      button.setAttribute('aria-pressed', String(dark));
    });
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#111611' : '#f5f5f1');
  }

  function applyTheme(theme) {
    root.setAttribute('data-theme', theme);
    syncControls();
  }

  // This script runs in the head before the stylesheets are painted.
  applyTheme(preference || systemTheme());

  document.addEventListener('click', function (event) {
    var target = event.target;
    var button = target && typeof target.closest === 'function' ? target.closest('[data-theme-toggle]') : null;
    if (!button) return;
    event.preventDefault();
    preference = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(preference);
    try { window.localStorage.setItem(key, preference); } catch (error) { /* Keep the in-memory choice. */ }
  });

  function followSystem() {
    if (!preference) applyTheme(systemTheme());
  }

  try {
    if (system && typeof system.addEventListener === 'function') system.addEventListener('change', followSystem);
    else if (system && typeof system.addListener === 'function') system.addListener(followSystem);
  } catch (error) { /* A missing listener must not interrupt app startup. */ }

  // Keep tabs in sync; clearing the saved choice restores system appearance.
  window.addEventListener('storage', function (event) {
    if (event.key !== key && event.key !== null) return;
    preference = validTheme(event.newValue) ? event.newValue : null;
    applyTheme(preference || systemTheme());
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', syncControls, { once: true });
  else syncControls();
}());
