(() => {
  'use strict';
  const appHashes = new Set(['sports', 'copy', 'wallet', 'bets', 'games', 'live', 'admin', 'verification']);
  const current = new URL(window.location.href);
  const legacyPage = current.hash.slice(1).split('?')[0];
  if (appHashes.has(legacyPage) || current.searchParams.has('stripe_return')) {
    const destination = new URL('/app', current.origin);
    destination.search = current.search;
    destination.hash = appHashes.has(legacyPage) ? current.hash : '#wallet';
    window.location.replace(destination.href);
    return;
  }
  document.documentElement.classList.add('landing-js');
  const toggle = document.querySelector('.landing-menu-toggle');
  const navigation = document.querySelector('#landing-navigation');
  if (toggle && navigation) {
    toggle.hidden = false;
    const closeMenu = () => {
      toggle.setAttribute('aria-expanded', 'false');
      navigation.classList.remove('is-open');
    };
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(open));
      navigation.classList.toggle('is-open', open);
    });
    navigation.addEventListener('click', event => { if (event.target.closest('a')) closeMenu(); });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') { closeMenu(); toggle.focus(); }
    });
    document.addEventListener('click', event => { if (!event.target.closest('.landing-header')) closeMenu(); });
  }
  const examplePoints = [
    { amount: '$20,000', event: 'Initial deposit', change: 'Starting capital', tone: '' },
    { amount: '$21,600', event: 'Northside FC vs Riverside FC · Won', change: '+$1,600.00', tone: 'positive' },
    { amount: '$20,600', event: 'Harbour FC vs Athletic Town · Lost', change: '−$1,000.00', tone: 'negative' },
    { amount: '$21,500', event: 'East City vs West United · Won', change: '+$900.00', tone: 'positive' }
  ];
  function selectPoint(index) {
    const point = examplePoints[index];
    if (!point) return;
    const capital = document.querySelector('#preview-capital');
    const event = document.querySelector('#preview-event');
    const change = document.querySelector('#preview-change');
    if (!capital || !event || !change) return;
    capital.replaceChildren(document.createTextNode(point.amount));
    const decimals = document.createElement('span'); decimals.textContent = '.00'; capital.append(decimals);
    event.textContent = point.event;
    change.textContent = point.change; change.className = point.tone;
    document.querySelectorAll('[data-preview-point]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.previewPoint) === index)));
    document.querySelectorAll('[data-preview-game]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.previewGame) === index)));
    const announcement = document.querySelector('#preview-announcement');
    if (announcement) announcement.textContent = `${point.event}. Example capital ${point.amount}. ${point.change}.`;
  }
  document.querySelectorAll('[data-preview-point], [data-preview-game]').forEach(button => {
    button.addEventListener('click', () => selectPoint(Number(button.dataset.previewPoint ?? button.dataset.previewGame)));
  });
})();
