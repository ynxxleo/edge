(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  const icon = name => '<svg aria-hidden="true"><use href="#i-' + escape(name) + '"/></svg>';
  const emptyPage = () => ({current_page:1,last_page:1,total:0});
  const state = {serverMode:false,user:null,adminTab:false,history:[],historyPage:emptyPage(),historyLoading:false,redeeming:false,codes:[],codesPage:emptyPage(),codesLoading:false,creating:false,revoking:false,issued:null,revoke:null,createKey:null,createSignature:null};
  let initialized = false, epoch = 0, adminEpoch = 0, walletEpoch = 0, historySerial = 0, codesSerial = 0, returnFocus = null;
  const signedIn = () => state.serverMode && Boolean(state.user?.id);
  const isAdmin = () => signedIn() && state.user?.is_admin === true;
  const walletActive = () => Boolean($('#wallet-page')) && !$('#wallet-page').hidden;
  const adminActive = () => state.adminTab && Boolean($('#admin-page')) && !$('#admin-page').hidden && isAdmin();
  const errorText = error => error?.errors ? Object.values(error.errors).flat().join(' ') : error?.message || 'This request could not be completed. Please try again.';
  const money = (cents, currency = 'USD') => new Intl.NumberFormat('en-US',{style:'currency',currency:/^[A-Z]{3}$/.test(currency) ? currency : 'USD'}).format(Number(cents || 0) / 100);
  const date = value => {const parsed = new Date(value);return value && !Number.isNaN(parsed.getTime()) ? new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}).format(parsed) : '—';};
  const validID = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
  const validMoney = value => Number.isSafeInteger(Number(value)) && Number(value) >= 100 && Number(value) <= 100000000;
  const mask = value => '•••• •••• •••• ' + (/^[A-Z0-9]{4}$/i.test(String(value || '')) ? String(value).toUpperCase() : '••••');
  const spinner = '<span class="promo-spinner" aria-hidden="true"></span>';
  function message(selector, text, error = false) {
    const target = $(selector);if (!target) return;
    target.textContent = text;target.classList.toggle('error',error);target.hidden = !text;
  }
  async function request(path, options = {}) {
    if (!signedIn() || !window.EdgeAPI?.request) throw new Error('Sign in to the Laravel app to use credit codes.');
    return window.EdgeAPI.request(path,options);
  }
  function pagination(data, fallback) {
    const current = Math.max(1,Number(data?.current_page) || 1), last = Math.max(current,Number(data?.last_page) || 1);
    return {current_page:current,last_page:last,total:Math.max(0,Number(data?.total) || fallback)};
  }
  function renderWallet() {
    const target = $('#promo-wallet-action');if (!target) return;
    if (!state.serverMode) {target.innerHTML = '<p class="promo-access-note">Credit codes are available in the Laravel app. This preview does not add wallet funds.</p><div class="promo-redeem-preview"><input aria-label="Credit code preview" placeholder="XXXX XXXX XXXX XXXX" disabled><button class="button green" type="button" disabled>Redeem code ↗</button></div>';return;}
    if (!signedIn()) {target.innerHTML = '<div class="promo-access-note">Sign in to redeem a code into your own wallet.</div><button class="button green" type="button" data-promo-signin>Sign in ' + icon('arrow') + '</button>';return;}
    target.innerHTML = '<form id="promo-redeem-form" autocomplete="off"><label class="promo-sr-only" for="promo-code-input">16-character credit code</label><input id="promo-code-input" name="code" type="text" required minlength="16" maxlength="80" pattern="[A-Za-z0-9]{16}" autocapitalize="characters" spellcheck="false" autocomplete="off" placeholder="YOUR16DIGITCODE1" aria-describedby="promo-code-hint"><button class="button green" type="submit" id="promo-redeem-submit">Redeem code ' + icon('arrow') + '</button><small id="promo-code-hint">Enter the 16 letters and numbers exactly as shared. Each code can be used once.</small></form>';
  }
  function renderHistory() {
    const section = $('#promo-history'), list = $('#promo-history-list');if (!section || !list) return;
    section.hidden = !signedIn();
    if (!signedIn()) {list.replaceChildren();return;}
    if (state.historyLoading) list.innerHTML = '<p class="promo-loading" role="status">' + spinner + 'Loading your redeemed codes…</p>';
    else list.innerHTML = state.history.length ? state.history.map(item => '<article class="promo-history-row"><div><strong>' + escape(mask(item.code_last4)) + '</strong><span>' + escape(date(item.redeemed_at)) + '</span>' + (item.label ? '<p>' + escape(item.label) + '</p>' : '') + '</div><span class="promo-status redeemed">Redeemed</span><strong>+' + escape(money(item.amount_cents,item.currency)) + '</strong></article>').join('') : '<p class="promo-empty">Your redeemed codes will appear here. Credit goes straight to your available wallet.</p>';
    const page = state.historyPage;$('#promo-history-pagination').hidden = state.historyLoading || page.last_page <= 1;$('#promo-history-page').textContent = 'Page ' + page.current_page + ' of ' + page.last_page;
    $('[data-promo-history-page="previous"]').disabled = state.historyLoading || page.current_page <= 1;$('[data-promo-history-page="next"]').disabled = state.historyLoading || page.current_page >= page.last_page;
    $('[data-promo-history-refresh]').disabled = state.historyLoading || state.redeeming;
  }
  async function loadHistory(page = 1) {
    if (!signedIn() || !walletActive()) return;
    const serial = ++historySerial, accountEpoch = epoch;state.historyLoading = true;renderHistory();
    try {
      const response = await request('/api/promo-codes?page=' + Math.max(1,Number(page) || 1));
      if (serial !== historySerial || accountEpoch !== epoch || !walletActive() || !signedIn()) return;
      if (!Array.isArray(response?.redemptions)) throw new Error('Your credit history could not be loaded. Use Refresh history to try again.');
      state.history = response.redemptions.slice(0,20);state.historyPage = pagination(response.pagination,state.history.length);
    } catch (error) {if (serial === historySerial && accountEpoch === epoch && walletActive()) {state.history = [];message('#promo-redeem-message',errorText(error),true);}}
    finally {if (serial === historySerial && accountEpoch === epoch) {state.historyLoading = false;renderHistory();}}
  }
  async function redeem(form) {
    if (!signedIn() || !walletActive() || state.redeeming) return;
    const input = $('[name="code"]',form);input.value = input.value.trim().toUpperCase();input.setCustomValidity(/^[A-Z0-9]{16}$/.test(input.value) ? '' : 'Enter exactly 16 letters and numbers.');
    if (!form.reportValidity()) return;
    const code = input.value, accountEpoch = epoch, viewEpoch = walletEpoch;state.redeeming = true;
    const controls = $$('input,button',form);controls.forEach(control => control.disabled = true);form.setAttribute('aria-busy','true');$('#promo-redeem-submit').innerHTML = spinner + 'Redeeming…';message('#promo-redeem-message','');
    try {
      const response = await request('/api/promo-codes/redeem',{method:'POST',body:{code}});
      if (accountEpoch !== epoch || !signedIn()) return;
      if (!validMoney(response?.redemption?.amount_cents)) throw new Error('The credit could not be confirmed. Refresh your wallet before trying again.');
      window.dispatchEvent(new CustomEvent('edge:promo-redeemed',{detail:{redemption:response.redemption}}));
      if (!walletActive() || viewEpoch !== walletEpoch) return;
      input.value = '';message('#promo-redeem-message',response.already_redeemed ? 'This code was already redeemed into your wallet for ' + money(response.redemption.amount_cents,response.redemption.currency) + '. It has not been credited again.' : money(response.redemption.amount_cents,response.redemption.currency) + ' added to your wallet. Your credit is ready for staking or withdrawal requests.');
      loadHistory(1);
    } catch (error) {if (accountEpoch === epoch && viewEpoch === walletEpoch && walletActive()) message('#promo-redeem-message',errorText(error),true);}
    finally {if (accountEpoch === epoch) state.redeeming = false;if (form.isConnected && accountEpoch === epoch) {controls.forEach(control => control.disabled = false);form.setAttribute('aria-busy','false');$('#promo-redeem-submit').innerHTML = 'Redeem code ' + icon('arrow');renderHistory();}}
  }
  function setAdminControls() {
    const form = $('#promo-create-form');if (!form) return;
    $$('input,button',form).forEach(control => control.disabled = !adminActive() || state.creating || state.revoking);
    $('#promo-admin-refresh').disabled = !adminActive() || state.codesLoading || state.creating || state.revoking;
    $('#promo-admin-status').disabled = !adminActive() || state.creating || state.revoking;
  }
  function renderCodes() {
    const list = $('#promo-admin-list');if (!list) return;
    if (!adminActive()) {list.innerHTML = '<p class="promo-empty">Open the Laravel app and sign in as an administrator to create and manage credit codes.</p>';$('#promo-admin-pagination').hidden = true;setAdminControls();return;}
    if (state.codesLoading) list.innerHTML = '<div class="promo-loading" role="status">' + spinner + 'Loading credit codes…</div>';
    else list.innerHTML = state.codes.length ? state.codes.map(code => {
      const status = ['active','redeemed','revoked','expired'].includes(code.status) ? code.status : 'expired';
      const redeemed = status === 'redeemed' ? '<span>Redeemed ' + escape(date(code.redeemed_at)) + (code.redeemed_by?.name ? ' by ' + escape(code.redeemed_by.name) : '') + '</span>' : status === 'revoked' ? '<span>Revoked ' + escape(date(code.revoked_at)) + '</span>' : '';
      return '<article class="promo-code-row"><div class="promo-code-top"><span class="promo-code-mask">' + escape(mask(code.code_last4)) + '</span><span class="promo-status ' + status + '">' + escape(status) + '</span></div><div class="promo-code-main"><div><strong>' + escape(money(code.amount_cents,code.currency)) + '</strong>' + (code.label ? '<p>' + escape(code.label) + '</p>' : '') + '</div>' + (status === 'active' ? '<button class="admin-small-button danger" type="button" data-promo-revoke="' + Number(code.id) + '"' + (state.creating || state.revoking ? ' disabled' : '') + '>Revoke code ↗</button>' : '') + '</div><div class="promo-code-meta"><span>Created ' + escape(date(code.created_at)) + '</span><span>' + (code.expires_at ? 'Expires ' + escape(date(code.expires_at)) : 'No expiry') + '</span>' + redeemed + '</div></article>';
    }).join('') : '<div class="promo-empty promo-empty-large"><span aria-hidden="true">✳</span><h3>A fresh start. A little extra.</h3><p>No credit codes in this category. Create a code to share wallet credit with a user.</p></div>';
    const page = state.codesPage;$('#promo-admin-count').textContent = page.total + (page.total === 1 ? ' code' : ' codes');$('#promo-admin-pagination').hidden = state.codesLoading || page.last_page <= 1;$('#promo-admin-page').textContent = 'Page ' + page.current_page + ' of ' + page.last_page;
    $('[data-promo-admin-page="previous"]').disabled = state.codesLoading || page.current_page <= 1;$('[data-promo-admin-page="next"]').disabled = state.codesLoading || page.current_page >= page.last_page;setAdminControls();
  }
  async function loadCodes(page = 1) {
    if (!adminActive()) {renderCodes();return;}
    const serial = ++codesSerial, accountEpoch = epoch;state.codesLoading = true;message('#promo-admin-message','');renderCodes();
    try {
      const status = $('#promo-admin-status')?.value || 'all';
      const response = await request('/api/admin/promo-codes?status=' + encodeURIComponent(status) + '&page=' + Math.max(1,Number(page) || 1));
      if (serial !== codesSerial || accountEpoch !== epoch || !adminActive()) return;
      if (!Array.isArray(response?.promo_codes)) throw new Error('The credit codes could not be loaded. Refresh codes to try again.');
      state.codes = response.promo_codes.filter(code => validID(code.id)).slice(0,20);state.codesPage = pagination(response.pagination,state.codes.length);
    } catch (error) {if (serial === codesSerial && accountEpoch === epoch && adminActive()) {state.codes = [];message('#promo-admin-message',errorText(error),true);}}
    finally {if (serial === codesSerial && accountEpoch === epoch) {state.codesLoading = false;renderCodes();}}
  }
  function amountCents(value) {
    const match = /^([0-9]+)(?:\.([0-9]{1,2}))?$/.exec(String(value).trim());if (!match) return null;
    const amount = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2,'0'));return validMoney(amount) ? amount : null;
  }
  function createData(form) {
    const amount = $('[name="amount"]',form), expiry = $('[name="expires_at"]',form);
    const cents = amountCents(amount.value);amount.setCustomValidity(cents == null ? 'Enter $1.00 to $1,000,000.00, with up to two decimal places.' : '');
    const expiryDate = expiry.value ? new Date(expiry.value) : null;
    expiry.setCustomValidity(expiryDate && (Number.isNaN(expiryDate.getTime()) || expiryDate.getTime() <= Date.now()) ? 'Choose an expiry in the future.' : '');
    if (!form.reportValidity() || cents == null) return null;
    return {amount_cents:cents,label:$('[name="label"]',form).value.trim(),expires_at:expiryDate ? expiryDate.toISOString() : null,current_password:$('[name="current_password"]',form).value};
  }
  function newKey() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    const random = new Uint8Array(16);window.crypto.getRandomValues(random);return Array.from(random,value => value.toString(16).padStart(2,'0')).join('');
  }
  function clearIssued() {state.issued = null;const target = $('#promo-issued');if (target) {target.replaceChildren();target.hidden = true;}}
  function renderIssued() {
    const target = $('#promo-issued');if (!target) return;
    if (!adminActive() || !state.issued) {clearIssued();return;}
    const code = state.issued;
    target.hidden = false;target.innerHTML = '<div class="promo-issued-heading"><span class="section-kicker">READY TO SHARE / ONE USE</span><button class="promo-text-button" type="button" data-promo-hide-code>Hide code ×</button></div><h3 id="promo-issued-title">' + escape(money(code.amount_cents,code.currency)) + ' of possibility<span>.</span></h3><p>Copy the full code now. This panel clears when you leave the credit code desk.</p><div class="promo-issued-code"><code id="promo-full-code">' + escape(code.value) + '</code><button type="button" class="button green" data-promo-copy>Copy code ↗</button></div><span class="promo-copy-result" id="promo-copy-result" role="status"></span><p class="promo-issued-note">' + (code.expires_at ? 'Expires ' + escape(date(code.expires_at)) + '. ' : '') + 'Anyone with this code can redeem it once. Keep it private.</p>';
  }
  async function create(form) {
    if (!adminActive() || state.creating || state.revoking) return;
    const data = createData(form);if (!data) return;
    const signature = JSON.stringify({amount_cents:data.amount_cents,label:data.label,expires_at:data.expires_at});
    try {if (!state.createKey || state.createSignature !== signature) {state.createKey = newKey();state.createSignature = signature;}} catch {message('#promo-create-message','Secure code creation is unavailable in this browser. Reload the Laravel app and try again.',true);return;}
    const accountEpoch = epoch, viewEpoch = adminEpoch;state.creating = true;setAdminControls();form.setAttribute('aria-busy','true');$('#promo-create-submit').innerHTML = spinner + 'Creating code…';message('#promo-create-message','');
    try {
      const response = await request('/api/admin/promo-codes',{method:'POST',body:{...data,idempotency_key:state.createKey}});
      if (accountEpoch !== epoch || viewEpoch !== adminEpoch || !adminActive()) return;
      if (!/^[A-Z0-9]{16}$/.test(String(response?.code || '')) || !validMoney(response?.promo_code?.amount_cents)) throw new Error('The created code could not be confirmed. Retry with the same details to recover the result without creating another code.');
      state.createKey = null;state.createSignature = null;form.reset();
      if (response.promo_code.status === 'active') {state.issued = {...response.promo_code,value:response.code};renderIssued();$('#promo-full-code')?.scrollIntoView?.({block:'nearest',behavior:'auto'});}
      else {clearIssued();message('#promo-create-message','This earlier request already created a code that is now ' + String(response.promo_code.status || 'unavailable') + '. No new code was created. Submit a new request if you need another code.');}
      loadCodes(1);
    } catch (error) {if (accountEpoch === epoch && viewEpoch === adminEpoch && adminActive()) message('#promo-create-message',errorText(error) + ' Your retry uses the same request while the amount, label and expiry stay unchanged.',true);}
    finally {data.current_password = '';if (accountEpoch === epoch && viewEpoch === adminEpoch) {state.creating = false;if (form.isConnected && adminActive()) {form.setAttribute('aria-busy','false');$('[name="current_password"]',form).value = '';$('#promo-create-submit').innerHTML = 'Create credit code ' + icon('plus');setAdminControls();renderCodes();}}}
  }
  async function copyCode() {
    if (!adminActive() || !state.issued) return;
    const value = state.issued.value, accountEpoch = epoch, viewEpoch = adminEpoch;
    try {if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');await navigator.clipboard.writeText(value);if (accountEpoch === epoch && viewEpoch === adminEpoch && adminActive() && state.issued?.value === value) message('#promo-copy-result','Code copied. Share it privately.');}
    catch {if (accountEpoch === epoch && viewEpoch === adminEpoch && adminActive() && state.issued?.value === value) message('#promo-copy-result','Select the code above and copy it manually.');}
  }
  function closeRevoke(restoreFocus = true) {
    const dialog = $('#promo-revoke-dialog');if (!dialog) return;
    dialog.hidden = true;$('#promo-revoke-form')?.reset();message('#promo-revoke-message','');$('#promo-revoke-description').textContent = '';state.revoke = null;document.body.classList.remove('promo-dialog-open');
    if (restoreFocus && returnFocus?.isConnected) returnFocus.focus();returnFocus = null;
  }
  function openRevoke(id, button) {
    if (!adminActive() || state.creating || state.revoking) return;
    const code = state.codes.find(item => Number(item.id) === Number(id));if (!code || code.status !== 'active') return;
    closeRevoke(false);state.revoke = {id:Number(code.id),version:Number(code.version)};returnFocus = button;
    $('#promo-revoke-description').textContent = mask(code.code_last4) + ' · ' + money(code.amount_cents,code.currency) + (code.label ? ' · ' + code.label : '') + '. This stops a future redemption.';
    $('#promo-revoke-dialog').hidden = false;document.body.classList.add('promo-dialog-open');$('#promo-revoke-form [name="current_password"]').focus();
  }
  async function revoke(form) {
    if (!adminActive() || !state.revoke || state.revoking || state.creating || !form.reportValidity()) return;
    const current = {...state.revoke}, accountEpoch = epoch, viewEpoch = adminEpoch;const body = {version:current.version,current_password:$('[name="current_password"]',form).value};state.revoking = true;
    $$('input,button',form).forEach(control => control.disabled = true);$$('[data-promo-revoke-close]').forEach(control => control.disabled = true);form.setAttribute('aria-busy','true');$('#promo-revoke-submit').innerHTML = spinner + 'Revoking…';message('#promo-revoke-message','');setAdminControls();
    try {
      const response = await request('/api/admin/promo-codes/' + current.id + '/revoke',{method:'POST',body});
      if (accountEpoch !== epoch || viewEpoch !== adminEpoch || !adminActive() || state.revoke?.id !== current.id) return;
      if (response?.promo_code?.status !== 'revoked') throw new Error('The code’s status could not be confirmed. Refresh codes before trying again.');
      closeRevoke();if (Number(state.issued?.id) === current.id) clearIssued();await loadCodes(state.codesPage.current_page);
    } catch (error) {if (accountEpoch === epoch && viewEpoch === adminEpoch && adminActive() && state.revoke?.id === current.id) message('#promo-revoke-message',errorText(error),true);}
    finally {body.current_password = '';if (accountEpoch === epoch && viewEpoch === adminEpoch) {state.revoking = false;$$('input,button',form).forEach(control => control.disabled = false);$$('[data-promo-revoke-close]').forEach(control => control.disabled = false);form.setAttribute('aria-busy','false');$('[name="current_password"]',form).value = '';$('#promo-revoke-submit').innerHTML = 'Revoke code ' + icon('close');setAdminControls();renderCodes();if ($('#promo-revoke-dialog').hidden && adminActive()) $('#promo-admin-refresh').focus();}}
  }
  function clearAdmin() {
    adminEpoch++;codesSerial++;state.codesLoading = false;state.creating = false;state.revoking = false;state.codes = [];state.codesPage = emptyPage();state.createKey = null;state.createSignature = null;clearIssued();closeRevoke(false);$('#promo-create-form')?.reset();$('#promo-create-form')?.setAttribute('aria-busy','false');if ($('#promo-create-submit')) $('#promo-create-submit').innerHTML = 'Create credit code ' + icon('plus');$$('#promo-revoke-form input,#promo-revoke-form button,[data-promo-revoke-close]').forEach(control => control.disabled = false);$('#promo-revoke-form')?.setAttribute('aria-busy','false');if ($('#promo-revoke-submit')) $('#promo-revoke-submit').innerHTML = 'Revoke code ' + icon('close');message('#promo-create-message','');message('#promo-admin-message','');if ($('#promo-admin-count')) $('#promo-admin-count').textContent = '';renderCodes();
  }
  function clearWallet() {
    walletEpoch++;historySerial++;state.historyLoading = false;state.history = [];state.historyPage = emptyPage();message('#promo-redeem-message','');$('#promo-redeem-form')?.reset();renderHistory();
  }
  function applySession(detail = {}) {
    const next = detail.user || null, nextMode = detail.serverMode === true;
    const changed = state.user?.id !== next?.id || state.serverMode !== nextMode || Boolean(state.user?.is_admin) !== Boolean(next?.is_admin);
    if (changed) {epoch++;clearAdmin();clearWallet();state.redeeming = false;}
    state.user = next;state.serverMode = nextMode;
    if (changed || !$('#promo-wallet-action')?.children.length) renderWallet();renderHistory();setAdminControls();
    if (changed && walletActive() && signedIn()) loadHistory(1);if (changed && adminActive()) loadCodes(1);
  }
  function init() {
    if (initialized || !$('#promo-wallet-template')) return;initialized = true;
    const wallet = $('#wallet-page'), walletTemplate = $('#promo-wallet-template');
    if (wallet && walletTemplate) {const fragment = walletTemplate.content.cloneNode(true);const overview = $('.wallet-overview',wallet);if (overview) overview.after(fragment);else wallet.append(fragment);}
    const tabs = $('#admin-workspace .admin-tabs'), template = $('#promo-admin-template');
    if (tabs && template) {const button = document.createElement('button');button.id = 'admin-tab-promos';button.dataset.adminTab = 'promos';button.setAttribute('role','tab');button.setAttribute('aria-controls','admin-promos-tab');button.setAttribute('aria-selected','false');button.tabIndex = -1;button.textContent = 'Credit codes';tabs.append(button);$('#admin-workspace').insertBefore(template.content.cloneNode(true),$('#admin-workspace .admin-desk-footer'));}
    document.addEventListener('submit',event => {if (event.target.id === 'promo-redeem-form') {event.preventDefault();redeem(event.target);}if (event.target.id === 'promo-create-form') {event.preventDefault();create(event.target);}if (event.target.id === 'promo-revoke-form') {event.preventDefault();revoke(event.target);}});
    document.addEventListener('input',event => {
      if (event.target.id === 'promo-code-input') {const start = event.target.selectionStart, end = event.target.selectionEnd;event.target.value = event.target.value.trim().toUpperCase();if (typeof start === 'number') event.target.setSelectionRange?.(start,end);event.target.setCustomValidity('');}
      if (event.target.closest('#promo-create-form') && ['amount','label','expires_at'].includes(event.target.name)) {state.createKey = null;state.createSignature = null;event.target.setCustomValidity('');}
    });
    document.addEventListener('change',event => {if (event.target.id === 'promo-admin-status' && adminActive()) loadCodes(1);});
    document.addEventListener('click',event => {
      const button = event.target.closest('button');if (!button || button.disabled) return;
      if (button.hasAttribute('data-promo-signin')) window.EdgeAPI?.openAuth?.('login');
      if (button.hasAttribute('data-promo-history-refresh')) loadHistory(state.historyPage.current_page);
      if (button.hasAttribute('data-promo-history-page')) loadHistory(state.historyPage.current_page + (button.dataset.promoHistoryPage === 'previous' ? -1 : 1));
      if (button.id === 'promo-admin-refresh' || (button.id === 'admin-refresh' && adminActive())) loadCodes(state.codesPage.current_page);
      if (button.hasAttribute('data-promo-admin-page')) loadCodes(state.codesPage.current_page + (button.dataset.promoAdminPage === 'previous' ? -1 : 1));
      if (button.hasAttribute('data-promo-hide-code')) clearIssued();if (button.hasAttribute('data-promo-copy')) copyCode();
      if (button.hasAttribute('data-promo-revoke')) openRevoke(button.dataset.promoRevoke,button);
      if (button.hasAttribute('data-promo-revoke-close') && !state.revoking) closeRevoke();
    });
    document.addEventListener('keydown',event => {
      const dialog = $('#promo-revoke-dialog');if (!dialog || dialog.hidden) return;
      if (event.key === 'Escape' && !state.revoking) {event.preventDefault();closeRevoke();}
      if (event.key === 'Tab') {const controls = $$('button:not(:disabled),input:not(:disabled)',dialog);const first = controls[0], last = controls.at(-1);if (!first) {event.preventDefault();return;}if (event.shiftKey && document.activeElement === first) {event.preventDefault();last.focus();}else if (!event.shiftKey && document.activeElement === last) {event.preventDefault();first.focus();}}
    });
    window.addEventListener('edge:session',event => applySession(event.detail || {}));
    window.addEventListener('edge:account-state',event => {const next = event.detail?.user || null;if (state.user?.id !== next?.id || Boolean(state.user?.is_admin) !== Boolean(next?.is_admin)) applySession({serverMode:state.serverMode,user:next});else state.user = next;});
    window.addEventListener('edge:navigate',event => {if (event.detail?.page === 'wallet') {if (signedIn()) loadHistory(1);else renderWallet();}else clearWallet();if (event.detail?.page !== 'admin') {state.adminTab = false;clearAdmin();}else if (adminActive()) loadCodes(1);});
    window.addEventListener('edge:admin-tab',event => {state.adminTab = event.detail?.tab === 'promos';if (state.adminTab) {renderCodes();if (adminActive()) loadCodes(1);}else clearAdmin();});
    applySession({serverMode:window.EdgeAPI?.serverMode === true,user:window.EdgeAPI?.user || null});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init);else init();
})();
