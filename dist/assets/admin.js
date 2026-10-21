(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  const icon = name => `<svg aria-hidden="true"><use href="#i-${escape(name)}"/></svg>`;
  const money = cents => new Intl.NumberFormat('en-US', {style:'currency', currency:'USD'}).format(Number(cents || 0) / 100);
  const date = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? 'Not scheduled' : new Intl.DateTimeFormat('en-NG', {day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(d); };
  const initials = value => String(value || '?').split(/\s+/).filter(Boolean).map(part => part[0]).join('').slice(0, 3).toUpperCase();
  const outcomeName = (event, outcome) => outcome === 'draw' ? 'Draw' : outcome === 'away' ? `${event.away_name} to win` : `${event.home_name} to win`;
  const final = event => ['finished','void'].includes(event.status);
  const status = value => `<span class="admin-status ${escape(value)}">${escape(value)}</span>`;
  const collection = (response, key) => response?.[key] || response?.data?.[key] || (Array.isArray(response?.data) ? response.data : Array.isArray(response) ? response : []);
  const canWrite = () => state.serverMode && Boolean(state.user?.is_admin);
  let root, initialized = false, requestSerial = 0, settingsSerial = 0, returnFocus = null, scoreDraft = null;
  const state = {serverMode:false,user:null,events:[],requests:[],strategies:[],picks:[],overview:{},tab:'events',loading:false,paymentSettings:null,settingsLoading:false,settingsError:''};
  const settingTextFields = ['stripe_publishable_key','manual_bank_name','manual_account_name','manual_account_number','manual_instructions','manual_reference_label','manual_support_contact'];
  function safeSettings(value = {}) {
    // Only retain the redacted fields needed by this interface. Secret values are write-only.
    return {version:Number(value.version) || 1,stripe_enabled:value.stripe_enabled === true,stripe_mode:value.stripe_mode === 'live' ? 'live' : 'test',stripe_secret_key_configured:value.stripe_secret_key_configured === true,stripe_webhook_secret_configured:value.stripe_webhook_secret_configured === true,manual_enabled:value.manual_enabled !== false,...Object.fromEntries(settingTextFields.map(key => [key,String(value[key] || '')]))};
  }
  function clearPaymentSettings() {
    settingsSerial++;
    state.paymentSettings = null;state.settingsLoading = false;state.settingsError = '';
    if ($('#admin-payment-settings')) $('#admin-payment-settings').innerHTML = '';
    if ($('[data-admin-edit-settings]')) $('[data-admin-edit-settings]').disabled = true;
  }

  function setDemoData() {
    const kickoff = hours => new Date(Date.now() + hours * 3600000).toISOString();
    state.events = [
      {id:101,sport:'football',league:'Premier League',country:'England',home_name:'Arsenal',away_name:'Chelsea',starts_at:kickoff(18),status:'open',odds_home:1.85,odds_draw:3.6,odds_away:4.2,home_score:null,away_score:null,version:1},
      {id:102,sport:'football',league:'Champions League',country:'Europe',home_name:'Manchester City',away_name:'Real Madrid',starts_at:kickoff(-1),status:'live',odds_home:2.1,odds_draw:3.4,odds_away:3.1,home_score:null,away_score:null,version:2},
      {id:103,sport:'basketball',league:'NBA',country:'USA',home_name:'LA Lakers',away_name:'Boston Celtics',starts_at:kickoff(30),status:'open',odds_home:1.95,odds_draw:null,odds_away:1.88,home_score:null,away_score:null,version:1},
      {id:104,sport:'football',league:'La Liga',country:'Spain',home_name:'Barcelona',away_name:'Atlético Madrid',starts_at:kickoff(-26),status:'finished',odds_home:1.72,odds_draw:3.8,odds_away:4.5,home_score:2,away_score:1,version:3},
      {id:105,sport:'tennis',league:'Tour singles',country:'International',home_name:'J. Sinner',away_name:'C. Alcaraz',starts_at:kickoff(22),status:'draft',odds_home:1.9,odds_draw:null,odds_away:1.92,home_score:null,away_score:null,version:1}
    ];
    state.requests = [
      {id:201,user:{name:'Jordan Adams',email:'jordan@example.test'},type:'deposit',amount_cents:2500000,method:'Bank transfer',details:{reference:'DEMO-TRANSFER-001'},reference:'DEMO-TRANSFER-001',status:'pending',created_at:kickoff(-2)},
      {id:202,user:{name:'Alex Morgan',email:'alex@example.test'},type:'withdrawal',amount_cents:1500000,method:'Bank transfer',details:{bank:'Example Bank',account_name:'Alex Morgan',account_number:'•••• 4812'},status:'pending',created_at:kickoff(-1)},
      {id:203,user:{name:'Taylor James',email:'taylor@example.test'},type:'deposit',amount_cents:5000000,method:'Bank transfer',status:'approved',admin_reference:'DEMO-VERIFIED-002',created_at:kickoff(-24)}
    ];
    state.strategies = [
      {id:1,name:'Touchline Edge',sport:'football',risk:'balanced',stake_percentage:2,min_deposit_cents:500000,active:true},
      {id:2,name:'Court Vision',sport:'basketball',risk:'measured',stake_percentage:2,min_deposit_cents:500000,active:true},
      {id:3,name:'Mixed Playbook',sport:'multiple',risk:'dynamic',stake_percentage:3,min_deposit_cents:500000,active:true}
    ];
    state.picks = [{id:301,strategy_id:1,event_id:104,strategy:state.strategies[0],event:state.events[3],outcome:'home',odds:1.72,status:'won',created_at:kickoff(-30)}];
    state.overview = {counts:{open_bets:24},recent_audits:[{action:'event.result',description:'Barcelona vs Atlético Madrid settled',created_at:kickoff(-24)},{action:'wallet.approved',description:'Deposit request reviewed',created_at:kickoff(-24)},{action:'event.updated',description:'Manchester City odds updated',created_at:kickoff(-1)}]};
  }

  function feedback(message, error = false) {
    const element = $('#admin-feedback');
    element.textContent = message;
    element.classList.toggle('error', error);
    element.hidden = !message;
  }
  function modalError(error) {
    const element = $('#admin-modal-error');
    if (!element) return;
    const validation = error?.errors ? Object.values(error.errors).flat().join(' ') : '';
    element.textContent = validation || error?.message || 'The action could not be completed. Refresh the desk and try again.';
    element.hidden = false;
  }
  async function request(path, options = {}) {
    if (!canWrite() || !window.EdgeAPI?.request) throw new Error('Sign in to the Laravel app with an administrator account to make changes.');
    return window.EdgeAPI.request(path, options);
  }
  async function mutate(path, body, method = 'POST', message = 'Operations desk updated.') {
    const form = $('#admin-modal-content form');
    if (form?.dataset.submitting === 'true') return;
    if (form) {form.dataset.submitting = 'true'; $$('button[type="submit"]', form).forEach(button => button.disabled = true);}
    try {
      const response = await request(path, {method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      closeModal();
      feedback(message);
      window.dispatchEvent(new CustomEvent('edge:admin-refresh'));
      await refresh();
      return response;
    } catch (error) {
      modalError(error);
      if (form) {form.dataset.submitting = 'false'; $$('button[type="submit"]', form).forEach(button => button.disabled = false);}
    }
  }
  function applySession(detail = {}) {
    state.serverMode = detail.serverMode === true;
    state.user = detail.user || null;
    closeModal();
    clearPaymentSettings();
    if (!state.serverMode) {
      setDemoData();
      $('#admin-mode-badge').textContent = 'PREVIEW DESK';
      $('#admin-access').hidden = true;
      $('#admin-workspace').hidden = false;
      $('#admin-preview-notice').hidden = false;
      render();
      if (state.tab === 'settings') loadPaymentSettings();
    } else if (!canWrite()) {
      requestSerial++;
      state.events = [];state.requests = [];state.picks = [];state.overview = {};
      $('#admin-mode-badge').textContent = 'ADMIN ACCESS';
      $('#admin-access').hidden = false;
      $('#admin-workspace').hidden = true;
      $('#admin-access-message').textContent = state.user ? 'This account does not have administrator access. Use an administrator account to manage games, payments and settlements.' : 'Sign in with an administrator account to manage games, odds and settlements.';
      $('[data-admin-signin]').hidden = Boolean(state.user);
    } else {
      $('#admin-mode-badge').textContent = 'OPERATIONS LIVE';
      $('#admin-access').hidden = true;
      $('#admin-workspace').hidden = false;
      $('#admin-preview-notice').hidden = true;
      refresh();
      if (state.tab === 'settings') loadPaymentSettings();
    }
  }
  async function refresh() {
    if (!canWrite()) {if (!state.serverMode) render();return;}
    const serial = ++requestSerial;
    state.loading = true;
    $('#admin-refresh').disabled = true;
    try {
      const responses = await Promise.allSettled([
        request('/api/admin/events'), request('/api/admin/wallet-requests'), request('/api/copy/strategies'), request('/api/admin/copy-picks'), request('/api/admin/overview')
      ]);
      if (serial !== requestSerial || !canWrite()) return;
      const keys = ['events','requests','strategies','picks'];
      responses.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          if (index < 4) state[keys[index]] = collection(result.value, keys[index]);
          else state.overview = result.value?.data || result.value || {};
        }
      });
      const failed = responses.find(response => response.status === 'rejected');
      if (failed) feedback(failed.reason?.message || 'Some operations data could not be loaded. Refresh to try again.', true);
      render();
      $('#admin-updated-at').textContent = `UPDATED ${new Intl.DateTimeFormat('en-NG',{hour:'2-digit',minute:'2-digit'}).format(new Date())} / EDGE`;
    } catch (error) {feedback(error.message, true);}
    finally {if (serial === requestSerial) {state.loading = false;$('#admin-refresh').disabled = false;}}
  }
  function render() {
    const counts = state.overview.counts || {};
    const pending = state.requests.filter(item => item.status === 'pending').length;
    const open = state.events.filter(event => event.status === 'open' && new Date(event.starts_at).getTime() > Date.now()).length;
    const summary = [
      ['GAMES ON THE BOARD',state.events.length,'Across every competition','football'],
      ['OPEN MARKETS',open,'Available for new stakes','flame'],
      ['PAYMENTS TO REVIEW',pending,'Awaiting your verification','wallet'],
      ['ACTIVE STAKES',counts.open_bets ?? '—','Singles, multiples & copy stakes','trophy']
    ];
    $('#admin-summary').innerHTML = summary.map(([label,value,note,symbol]) => `<div class="admin-stat"><span>${label}</span><strong>${escape(value)}</strong><small>${note}</small><i class="admin-stat-icon">${icon(symbol)}</i></div>`).join('');
    $('#admin-games-count').textContent = state.events.length;
    $('#admin-requests-count').textContent = pending;
    $('#admin-picks-count').textContent = state.picks.length;
    renderEvents();renderRequests();renderPicks();renderAudits();
  }
  function empty(title, description, symbol = 'search') {return `<div class="admin-empty">${icon(symbol)}<h3>${escape(title)}</h3><p>${escape(description)}</p></div>`;}
  function renderEvents() {
    const query = $('#admin-event-search').value.trim().toLowerCase();
    const filter = $('#admin-event-status').value;
    const events = state.events.filter(event => (filter === 'all' || event.status === filter) && `${event.home_name} ${event.away_name} ${event.league} ${event.sport}`.toLowerCase().includes(query));
    $('#admin-event-list').innerHTML = events.length ? events.map(event => `<article class="admin-event-card"><div class="admin-event-meta">${icon(['football','basketball','tennis','cricket','boxing'].includes(event.sport) ? event.sport : 'game')}<span>${escape(event.country || event.sport)}</span><span>/</span><span>${escape(event.league)}</span>${status(event.status)}</div><div class="admin-event-core"><div class="admin-event-teams"><div class="admin-team"><span class="admin-team-crest">${escape(initials(event.home_name))}</span><span>${escape(event.home_name)}</span><strong class="admin-score">${event.home_score == null ? '–' : escape(event.home_score)}</strong></div><div class="admin-team"><span class="admin-team-crest">${escape(initials(event.away_name))}</span><span>${escape(event.away_name)}</span><strong class="admin-score">${event.away_score == null ? '–' : escape(event.away_score)}</strong></div></div><div class="admin-odds">${['home','draw','away'].map((outcome,index) => `<div class="admin-odd"><span>${['1','X','2'][index]}</span><strong>${event[`odds_${outcome}`] == null ? '—' : Number(event[`odds_${outcome}`]).toFixed(2)}</strong></div>`).join('')}</div></div><div class="admin-event-footer"><span class="admin-event-date">${icon('clock')}${escape(date(event.starts_at))}</span><div class="admin-event-actions">${final(event) ? `<button class="admin-small-button" data-admin-result="${escape(event.id)}">View final result</button>` : `<button class="admin-small-button" data-admin-edit="${escape(event.id)}">Edit game & odds</button><button class="admin-small-button primary" data-admin-result="${escape(event.id)}">Set final score</button><button class="admin-small-button danger" data-admin-void="${escape(event.id)}">Void</button>`}</div></div></article>`).join('') : empty('A clear board. A fresh start.', state.events.length ? 'Try another search or game status.' : 'Create a game to open a new market for your users.', 'football');
  }
  function renderRequests() {
    const filter = $('#admin-request-status').value;
    const requests = state.requests.filter(item => filter === 'all' || item.status === filter);
    $('#admin-request-list').innerHTML = requests.length ? requests.map(item => `<article class="admin-request-card"><div class="admin-request-user"><span class="admin-request-avatar">${escape(initials(item.user?.name))}</span><div><h3>${escape(item.user?.name || 'Account holder')}</h3><p>${escape(item.user?.email || `User #${item.user_id || '—'}`)}<br>REQUEST #${escape(item.id)}</p></div></div><div class="admin-request-amount"><strong>${money(item.amount_cents)}</strong><span>${escape(item.type)} / ${escape(item.method_name || item.method || 'Manual review')}<br>${escape(date(item.created_at))}</span></div><div class="admin-request-actions">${status(item.status)}<button class="admin-small-button ${item.status === 'pending' ? 'primary' : ''}" data-admin-review="${escape(item.id)}">${item.status === 'pending' ? 'Review request ↗' : 'View request'}</button></div>${item.admin_reference || item.review_note ? `<div class="admin-request-reference">${item.admin_reference ? `Review reference: ${escape(item.admin_reference)}` : `Review note: ${escape(item.review_note)}`}</div>` : ''}</article>`).join('') : empty('All clear at the payment desk.', filter === 'pending' ? 'New deposit and withdrawal requests will appear here for manual review.' : 'There are no payment requests in this category.', 'wallet');
  }
  function renderPicks() {
    $('#admin-pick-list').innerHTML = state.picks.length ? state.picks.map(pick => {
      const event = pick.event || state.events.find(item => Number(item.id) === Number(pick.event_id)) || {};
      const strategy = pick.strategy || state.strategies.find(item => Number(item.id) === Number(pick.strategy_id)) || {};
      const label = pick.status || (event.status === 'finished' ? 'settled' : event.status === 'void' ? 'void' : 'pending');
      return `<article class="admin-pick-card"><div class="admin-pick-top"><span>${escape(strategy.name || 'Copy strategy')} / PICK #${escape(pick.id)}</span>${status(label)}</div><h3>${escape(outcomeName(event,pick.outcome))}</h3><p>${escape(event.home_name || 'Home')} vs ${escape(event.away_name || 'Away')}<br>${escape(event.league || '')}</p><div class="admin-pick-bottom"><strong>${Number(pick.odds || pick.locked_odds || 0).toFixed(2)} <small>ODDS</small></strong><span>${escape(date(pick.created_at))}<br>${event.home_score == null ? 'Settles with the final game result' : `FINAL SCORE ${escape(event.home_score)} — ${escape(event.away_score)}`}</span></div></article>`;
    }).join('') : empty('Your next shared move starts here.', 'Publish a strategy pick to copy stakes into eligible funded positions.', 'game');
  }
  function renderAudits() {
    const audits = state.overview.recent_audits || [];
    $('#admin-audit-list').innerHTML = audits.length ? audits.slice(0,5).map(item => `<div class="admin-audit-item"><p>${escape(item.description || item.action?.replace(/[._]/g,' ') || 'Operations update')}${item.subject_id || item.entity_id ? ` / #${escape(item.subject_id || item.entity_id)}` : ''}</p><span>${escape(date(item.created_at))}</span></div>`).join('') : '<div class="admin-audit-item"><p>No operations recorded yet.</p><span>Your next update will appear here.</span></div>';
  }
  function selectTab(tab) {
    if (!['events','payments','copy','settings','kyc','support','promos'].includes(tab)) return;
    if (state.tab === 'settings' && tab !== 'settings') closeModal();
    state.tab = tab;
    $$('[data-admin-tab]').forEach(button => { const active = button.dataset.adminTab === tab;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));button.tabIndex = active ? 0 : -1; });
    $$('.admin-tab-panel').forEach(panel => panel.hidden = panel.id !== `admin-${tab}-tab`);
    if (tab === 'settings') loadPaymentSettings();
    window.dispatchEvent(new CustomEvent('edge:admin-tab',{detail:{tab}}));
  }
  async function loadPaymentSettings(force = false) {
    if (!state.serverMode) {state.paymentSettings = safeSettings({manual_bank_name:'Example Bank',manual_account_name:'EDGE Preview',manual_account_number:'•••• 0000',manual_instructions:'Preview details only. Do not send funds.',manual_reference_label:'Transfer reference'});renderPaymentSettings();return;}
    if (!canWrite() || state.settingsLoading || (state.paymentSettings && !force)) return;
    const serial = ++settingsSerial;
    state.settingsLoading = true;state.settingsError = '';renderPaymentSettings();
    try {
      const response = await request('/api/admin/payment-settings');
      if (serial !== settingsSerial || !canWrite()) return;
      if (!response?.settings || !Number.isInteger(Number(response.settings.version))) throw new Error('Payment settings could not be loaded.');
      state.paymentSettings = safeSettings(response.settings);
    } catch (error) {
      if (serial !== settingsSerial || !canWrite()) return;
      state.settingsError = 'Payment settings could not be loaded. Refresh to try again.';
    } finally {if (serial === settingsSerial) {state.settingsLoading = false;renderPaymentSettings();}}
  }
  function renderPaymentSettings() {
    const container = $('#admin-payment-settings');
    $('[data-admin-edit-settings]').disabled = !state.paymentSettings || state.settingsLoading || Boolean(state.settingsError);
    if (state.settingsLoading) {container.innerHTML = '<p class="admin-settings-loading">Loading payment settings…</p>';return;}
    if (state.settingsError) {container.innerHTML = `<div class="admin-settings-load-error" role="alert"><p>${escape(state.settingsError)}</p><button class="admin-small-button" data-admin-retry-settings>Try again</button></div>`;return;}
    const settings = state.paymentSettings;if (!settings) {container.innerHTML = '';return;}
    const mode = settings.stripe_mode === 'live' ? 'LIVE MODE' : 'SANDBOX / TEST';
    const detail = (label,value) => `<div><dt>${label}</dt><dd>${escape(value || 'Not configured')}</dd></div>`;
    container.innerHTML = `<div class="admin-settings-grid"><article class="admin-settings-card"><div class="admin-settings-card-header"><span class="admin-settings-channel">01 / CARD PAYMENTS</span><span class="admin-status ${settings.stripe_enabled ? 'open' : 'finished'}">${settings.stripe_enabled ? 'Enabled' : 'Disabled'}</span></div><h3>Stripe<span>↗</span></h3><span class="admin-settings-mode ${settings.stripe_mode === 'live' ? 'live' : ''}">${mode}</span><dl>${detail('Publishable key',settings.stripe_publishable_key ? 'Configured' : '')}${detail('Secret key',settings.stripe_secret_key_configured ? 'Saved securely' : '')}${detail('Webhook signing secret',settings.stripe_webhook_secret_configured ? 'Saved securely' : '')}</dl><p>Customers pay through Stripe Checkout. Wallet credit follows a verified payment notification.</p></article><article class="admin-settings-card"><div class="admin-settings-card-header"><span class="admin-settings-channel">02 / MANUAL DEPOSITS</span><span class="admin-status ${settings.manual_enabled ? 'open' : 'finished'}">${settings.manual_enabled ? 'Enabled' : 'Disabled'}</span></div><h3>Bank transfer<span>↗</span></h3><span class="admin-settings-mode">ADMIN VERIFICATION</span><dl>${detail('Bank',settings.manual_bank_name)}${detail('Account name',settings.manual_account_name)}${detail('Account number',settings.manual_account_number)}</dl><p>Users see only your manual payment details and instructions. Verify receipt before approving a deposit.</p></article></div><div class="admin-settings-webhook"><span>STRIPE WEBHOOK ENDPOINT</span><code>${escape(window.location.origin + '/api/payments/stripe/webhook')}</code><p>Add this endpoint in Stripe and save its signing secret.</p></div>`;
  }
  function paymentSettingsForm() {
    const settings = state.paymentSettings;if (!settings || state.settingsLoading || state.settingsError) return;
    const disabled = canWrite() ? '' : ' disabled';
    const settingField = (name,label,type = 'text',extra = '') => field(name,label,settings[name] || '',type,`${disabled} ${extra}`);
    const secretField = (name,label,configured) => `<label class="admin-field"><span>${label}</span><input name="${name}" type="password" autocomplete="new-password" maxlength="255" placeholder="${configured ? 'Saved — leave blank to keep' : 'Enter a new secret'}"${disabled}><small class="admin-field-note">${configured ? 'A secret is saved. Leave blank to keep it.' : 'No secret saved.'} Existing secrets are never displayed.</small></label>`;
    openModal(`<span class="section-kicker">PAYMENT CHANNELS / SETTINGS</span><h2 id="admin-modal-title">SET THE FLOW<span>.</span></h2><p class="admin-modal-description">Update the credentials and payment details for your platform. Your current password is required for every save.</p><form id="admin-payment-settings-form" data-version="${escape(settings.version)}" autocomplete="off"><div class="admin-settings-form-section"><div class="admin-settings-form-title"><h3>Stripe</h3><span class="admin-settings-mode ${settings.stripe_mode === 'live' ? 'live' : ''}" id="admin-stripe-mode-label">${settings.stripe_mode === 'live' ? 'LIVE MODE' : 'SANDBOX / TEST'}</span></div><label class="admin-setting-toggle"><input type="checkbox" name="stripe_enabled" ${settings.stripe_enabled ? 'checked' : ''}${disabled}><span>Enable Stripe card deposits</span></label><div class="admin-form-grid">${selectField('stripe_mode','Stripe mode',[['test','Sandbox / test'],['live','Live payments']],settings.stripe_mode)}${settingField('stripe_publishable_key','Publishable key','text','autocomplete="off" maxlength="255" spellcheck="false"')}${secretField('stripe_secret_key','Secret key',settings.stripe_secret_key_configured)}${secretField('stripe_webhook_secret','Webhook signing secret',settings.stripe_webhook_secret_configured)}</div><p class="admin-field-note">Use credentials from the selected Stripe mode. Add this webhook endpoint in Stripe and save its signing secret.</p><code class="admin-settings-endpoint">${escape(window.location.origin + '/api/payments/stripe/webhook')}</code></div><div class="admin-settings-form-section"><div class="admin-settings-form-title"><h3>Manual bank transfer</h3><span class="admin-settings-mode">MANUAL VERIFICATION</span></div><label class="admin-setting-toggle"><input type="checkbox" name="manual_enabled" ${settings.manual_enabled ? 'checked' : ''}${disabled}><span>Enable manual deposits</span></label><p class="admin-field-note">Users will see only these manual payment details and instructions. Withdrawals continue through the payment review desk.</p><div class="admin-form-grid">${settingField('manual_bank_name','Bank name','text','maxlength="100"')}${settingField('manual_account_name','Account name','text','maxlength="100"')}${settingField('manual_account_number','Account number','text','maxlength="20" inputmode="numeric"')}${settingField('manual_reference_label','Transfer reference label','text','maxlength="80"')}${settingField('manual_support_contact','Payment support contact','text','maxlength="160"')}<label class="admin-field admin-field-full"><span>Payment instructions</span><textarea name="manual_instructions" rows="3" maxlength="1500"${disabled}>${escape(settings.manual_instructions)}</textarea></label></div></div><div class="admin-settings-form-section admin-settings-verification"><h3>Confirm this update</h3>${field('current_password','Your current password','','password',`required maxlength="128" autocomplete="current-password"${disabled}`,true)}</div>${formEnd('Save payment settings')}</form>`);
    if (!canWrite()) $('#admin-payment-settings-form select').disabled = true;
  }
  function paymentSettingsError(error) {
    const messages = [];
    const labels = {current_password:'Enter your correct current password.',version:'Settings changed in another session. Close this form, refresh settings and try again.',stripe_enabled:'Stripe could not be enabled. Check the required credentials.',stripe_mode:'Select a valid Stripe mode.',stripe_publishable_key:'Check the publishable key and selected mode.',stripe_secret_key:'Check the secret key and selected mode.',stripe_webhook_secret:'Check the webhook signing secret.',manual_bank_name:'Enter a bank name for manual deposits.',manual_account_name:'Enter an account name for manual deposits.',manual_account_number:'Enter an account number for manual deposits.',manual_instructions:'Check the payment instructions.',manual_reference_label:'Check the transfer reference label.',manual_support_contact:'Check the payment support contact.'};
    // Do not echo upstream validation strings: provider errors can contain submitted credentials.
    Object.keys(error?.errors || {}).forEach(key => {if (labels[key] && !messages.includes(labels[key])) messages.push(labels[key]);});
    if (error?.status === 409 && !messages.length) messages.push(labels.version);
    modalError(new Error(messages.join(' ') || 'Payment settings could not be saved. Check your details and try again.'));
  }
  async function savePaymentSettings(form) {
    if (form.dataset.submitting === 'true') return;
    const password = form.elements.current_password.value;
    if (!password) return paymentSettingsError({errors:{current_password:[]}});
    if (!form.reportValidity()) return;
    const payload = {version:Number(form.dataset.version),current_password:password,stripe_enabled:form.elements.stripe_enabled.checked,stripe_mode:form.elements.stripe_mode.value,manual_enabled:form.elements.manual_enabled.checked};
    settingTextFields.forEach(key => payload[key] = form.elements[key].value.trim());
    ['stripe_secret_key','stripe_webhook_secret'].forEach(key => {const value = form.elements[key].value.trim();if (value) payload[key] = value;});
    form.dataset.submitting = 'true';$('button[type="submit"]',form).disabled = true;
    const serial = settingsSerial;
    try {
      const response = await request('/api/admin/payment-settings',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      if (serial !== settingsSerial || !canWrite()) return;
      if (form.isConnected) closeModal();
      if (response?.settings) state.paymentSettings = safeSettings(response.settings);else state.paymentSettings = null;
      renderPaymentSettings();feedback('Payment settings saved. Updated manual details apply to new payment requests.');
      window.dispatchEvent(new CustomEvent('edge:payment-settings-updated'));
      if (!state.paymentSettings) await loadPaymentSettings(true);
    } catch (error) {
      if (serial !== settingsSerial || !canWrite() || !form.isConnected) return;
      paymentSettingsError(error);
      form.dataset.submitting = 'false';$('button[type="submit"]',form).disabled = false;
    } finally {
      // Remove transient password/secret material even when a save fails or the session changes.
      ['current_password','stripe_secret_key','stripe_webhook_secret'].forEach(key => {if (form.elements[key]) form.elements[key].value = '';});
      payload.current_password = '';delete payload.stripe_secret_key;delete payload.stripe_webhook_secret;
    }
  }
  function previewNote() {return canWrite() ? '' : '<p class="admin-modal-preview-note">Read-only preview. Publishing and payment review are available in the Laravel app to authenticated administrators.</p>';}
  function formEnd(label, enabled = true) {return `<div class="admin-modal-error" id="admin-modal-error" role="alert" hidden></div>${previewNote()}<div class="admin-modal-actions"><button type="button" class="button outline" data-admin-close>Cancel</button><button type="submit" class="button green" ${!canWrite() || !enabled ? 'disabled' : ''}>${label} ${icon('arrow')}</button></div>`;}
  function openModal(html) {
    returnFocus = document.activeElement;
    $('#admin-modal-content').innerHTML = html;
    $('#admin-modal').hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(() => { const target = $('#admin-modal-content input:not([disabled]),#admin-modal-content select:not([disabled]),#admin-modal-content button:not([disabled])') || $('[data-admin-close]');target?.focus(); }, 0);
  }
  function closeModal() {
    if (!initialized || !$('#admin-modal') || $('#admin-modal').hidden) return;
    $$('#admin-modal-content input[type="password"]').forEach(input => {input.value = '';});
    $('#admin-modal').hidden = true;
    $('#admin-modal-content').innerHTML = '';
    document.body.style.overflow = '';
    returnFocus?.focus?.();
  }
  function field(name, label, value = '', type = 'text', attributes = '', full = false) {
    return `<label class="admin-field ${full ? 'admin-field-full' : ''}"><span>${label}</span><input name="${escape(name)}" type="${type}" value="${escape(value)}" ${attributes}></label>`;
  }
  const selectField = (name,label,options,value,full = false) => `<label class="admin-field ${full ? 'admin-field-full' : ''}"><span>${label}</span><select name="${escape(name)}">${options.map(([id,title]) => `<option value="${escape(id)}" ${String(id) === String(value) ? 'selected' : ''}>${escape(title)}</option>`).join('')}</select></label>`;
  function localDateTime(value) {
    const d = new Date(value);if (Number.isNaN(d.getTime())) return '';
    const pad = value => String(value).padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function eventForm(id) {
    const event = state.events.find(item => Number(item.id) === Number(id));
    if (event && final(event)) return scoreForm(id);
    const e = event || {sport:'football',status:'draft',starts_at:new Date(Date.now()+86400000).toISOString()};
    openModal(`<span class="section-kicker">OPERATIONS / ${event ? `GAME #${escape(id)}` : 'NEW MARKET'}</span><h2 id="admin-modal-title">${event ? 'SHAPE THE GAME' : 'BUILD THE NEXT GAME'}<span>.</span></h2><p class="admin-modal-description">Publish a scheduled game with match-winner odds. Open future games accept stakes; live and suspended games keep existing stakes and stop new ones.</p><form id="admin-event-form" data-event-id="${escape(event?.id || '')}" data-version="${escape(event?.version || '')}"><div class="admin-form-grid">${selectField('sport','Sport',[['football','Football'],['basketball','Basketball'],['tennis','Tennis'],['cricket','Cricket'],['boxing','Boxing'],['esports','Esports']],e.sport)}${selectField('status','Market status',[['draft','Draft / unpublished'],['open','Open for staking'],['live','Live / staking closed'],['suspended','Suspended / no new stakes']],e.status)}${field('league','Competition',e.league,'text','required maxlength="120"')}${field('country','Country / region',e.country,'text','maxlength="80"')}${field('home_name','Home team / player',e.home_name,'text','required maxlength="120"')}${field('away_name','Away team / player',e.away_name,'text','required maxlength="120"')}${field('starts_at','Scheduled start <small>· your local time</small>',localDateTime(e.starts_at),'datetime-local','required',true)}<p class="admin-field-note admin-field-full">Opening a market requires a future start. Final results are published separately after the scheduled start.</p></div><h3 class="admin-form-subheading">MATCH WINNER / DECIMAL ODDS</h3><div class="admin-odds-fields">${field('odds_home','1 / Home',e.odds_home ?? '','number','required min="1.01" max="1000" step="0.01"')}${field('odds_draw','X / Draw <small>optional</small>',e.odds_draw ?? '','number','min="1.01" max="1000" step="0.01"')}${field('odds_away','2 / Away',e.odds_away ?? '','number','required min="1.01" max="1000" step="0.01"')}</div><p class="admin-field-note" style="margin-top:12px">Leave draw odds empty for a two-outcome market. Existing stakes keep their accepted odds.</p>${formEnd(event ? 'Save game & odds' : 'Create game')}</form>`);
  }
  function scoreForm(id) {
    const event = state.events.find(item => Number(item.id) === Number(id));if (!event) return;
    if (event.status === 'void') {
      openModal(`<span class="section-kicker">OPERATIONS / GAME #${escape(id)}</span><h2 id="admin-modal-title">GAME VOIDED<span>.</span></h2><p class="admin-modal-description">${escape(event.home_name)} vs ${escape(event.away_name)}. This event is finalized and cannot accept further stakes.</p><div class="admin-final-note">Stakes were settled using the void rules. A void single returns its stake; a void accumulator leg uses odds of 1.00.</div><div class="admin-modal-actions"><button class="button outline" data-admin-close>Close result</button></div>`);return;
    }
    const settled = final(event);
    const started = new Date(event.starts_at).getTime() <= Date.now();
    openModal(`<span class="section-kicker">OPERATIONS / GAME #${escape(id)}</span><h2 id="admin-modal-title">${settled ? 'THE FINAL RESULT' : 'MAKE IT FINAL'}<span>.</span></h2><p class="admin-modal-description">${escape(event.league)} / ${escape(date(event.starts_at))}. ${settled ? 'The final score is locked and the stakes have been settled.' : 'Enter the verified final score when this game has ended. Review the settlement before publishing.'}</p><form id="admin-score-form" data-event-id="${escape(id)}"><div class="admin-score-fields">${field('home_score',escape(event.home_name),event.home_score ?? '','number',`required min="0" max="999" step="1" ${settled ? 'disabled' : ''}`)}<span>—</span>${field('away_score',escape(event.away_name),event.away_score ?? '','number',`required min="0" max="999" step="1" ${settled ? 'disabled' : ''}`)}</div>${!started && !settled ? '<p class="admin-final-note">Final scores can be published after the scheduled game start.</p>' : ''}${settled ? '<div class="admin-final-note"><strong>Result published.</strong> Final scores are read-only so settled balances retain an auditable result.</div><div class="admin-modal-actions"><button type="button" class="button outline" data-admin-close>Close result</button></div>' : formEnd('Review settlement',started)}</form>`);
  }
  function confirmResult(id,home,away) {
    const event = state.events.find(item => Number(item.id) === Number(id));if (!event || final(event)) return;
    scoreDraft = {id,home,away};
    const winner = home === away ? 'draw' : home > away ? 'home' : 'away';
    openModal(`<span class="section-kicker">FINAL REVIEW / GAME #${escape(id)}</span><h2 id="admin-modal-title">CONFIRM THE RESULT<span>.</span></h2><p class="admin-modal-description">Publishing locks this final score and settles eligible stakes, including copy stakes. Review the teams and score carefully.</p><div class="admin-confirm-score"><div><span>${escape(event.home_name)}</span><strong>${home}</strong></div><span>—</span><div><span>${escape(event.away_name)}</span><strong>${away}</strong></div></div><div class="admin-final-note"><strong>Winning outcome: ${escape(outcomeName(event,winner))}.</strong><br>Winning singles credit their return at accepted odds. Losing stakes close without a return. Accumulators pay only after every leg is resolved. This action cannot be repeated to credit a second payout.</div><form id="admin-confirm-result-form" data-event-id="${escape(id)}"><label class="admin-confirm-label"><input name="confirmed" type="checkbox" required><span>I have verified that the game has ended and this is the correct final score. I understand this settles users’ funds.</span></label>${formEnd('Publish score & settle')}</form>`);
  }
  function voidForm(id) {
    const event = state.events.find(item => Number(item.id) === Number(id));if (!event || final(event)) return;
    openModal(`<span class="section-kicker">OPERATIONS / GAME #${escape(id)}</span><h2 id="admin-modal-title">VOID THIS GAME<span>?</span></h2><p class="admin-modal-description">${escape(event.home_name)} vs ${escape(event.away_name)}. Voiding closes this market permanently and applies the void rules to every associated stake.</p><div class="admin-final-note"><strong>Financial effect:</strong> single stakes are refunded. This event becomes an odds-1.00 leg in accumulators. Copied stakes use the same refund rules.</div><form id="admin-void-form" data-event-id="${escape(id)}"><label class="admin-field"><span>Reason for voiding</span><textarea name="reason" minlength="5" maxlength="500" required placeholder="e.g. Match abandoned with no official result"></textarea></label><label class="admin-confirm-label"><input name="confirmed" type="checkbox" required><span>I have verified the cancellation and authorize the related stake settlements.</span></label>${formEnd('Confirm void & settle')}</form>`);
  }
  function requestDetails(item) {
    const details = item.details || {};
    if (typeof details === 'string') return `<div><span>Details</span><strong>${escape(details)}</strong></div>`;
    const destination = details.payment_destination && typeof details.payment_destination === 'object' ? Object.entries(details.payment_destination).filter(([key,value]) => ['bank_name','account_name','account_number'].includes(key) && typeof value === 'string').map(([key,value]) => `<div><span>Payment ${escape(key.replace(/_/g,' '))}</span><strong>${escape(value)}</strong></div>`).join('') : '';
    const custom = details.manual_payment_method;
    if (custom && typeof custom === 'object') {
      const rows = [['Payment method', custom.name], ['Payment instructions', custom.instructions], ...((custom.fields || []).map(field => [field.label, details.answers?.[field.key] || '—'])), ['Payment reference', details.reference], ['Note', details.note]];
      return rows.filter(([,value]) => typeof value === 'string' && value).map(([label,value]) => `<div><span>${escape(label)}</span><strong class="manual-method-instructions">${escape(value)}</strong></div>`).join('');
    }
    return Object.entries(details).filter(([key,value]) => typeof value !== 'object' && value != null && !/token|secret|password/i.test(key)).map(([key,value]) => `<div><span>${escape(key.replace(/_/g,' '))}</span><strong>${escape(value)}</strong></div>`).join('') + destination;
  }
  function reviewForm(id) {
    const item = state.requests.find(request => Number(request.id) === Number(id));if (!item) return;
    const pending = item.status === 'pending';
    openModal(`<span class="section-kicker">PAYMENT DESK / REQUEST #${escape(id)}</span><h2 id="admin-modal-title">${pending ? 'REVIEW THE REQUEST' : 'PAYMENT RECORD'}<span>.</span></h2><p class="admin-modal-description">${item.type === 'deposit' ? 'Verify the incoming payment before crediting this wallet.' : 'Verify the completed payout before marking this withdrawal approved.'}</p><div class="admin-review-summary"><div><span>${escape(item.type?.toUpperCase())}</span><strong class="admin-review-amount">${money(item.amount_cents)}</strong></div><div><span>Account</span><strong>${escape(item.user?.name || 'Account holder')}</strong></div><div><span>Email</span><strong>${escape(item.user?.email || '—')}</strong></div><div><span>Method</span><strong>${escape(item.method_name || item.method || 'Manual review')}</strong></div><div><span>Requested</span><strong>${escape(date(item.created_at))}</strong></div><div><span>Status</span><strong>${escape(item.status)}</strong></div>${requestDetails(item)}${item.reference ? `<div><span>User reference</span><strong>${escape(item.reference)}</strong></div>` : ''}${item.admin_reference ? `<div><span>Review reference</span><strong>${escape(item.admin_reference)}</strong></div>` : ''}${item.review_note ? `<div><span>Review note</span><strong>${escape(item.review_note)}</strong></div>` : ''}</div>${pending ? `<form id="admin-review-form" data-request-id="${escape(id)}"><div class="admin-review-options"><label><input type="radio" name="decision" value="approve" checked>Approve request</label><label><input type="radio" name="decision" value="reject">Reject request</label></div><div class="admin-final-note" id="admin-review-effect">${item.type === 'deposit' ? 'Approval credits the verified deposit amount to the user’s wallet. Confirm receipt with your payment records first.' : 'Approval records the payout as completed. This action does not send a bank transfer. A rejected withdrawal releases its reserved funds back to the wallet.'}</div><label class="admin-field"><span id="admin-review-reference-label">Verified payment reference</span><input name="reference" id="admin-review-reference" type="text" minlength="3" maxlength="160" required placeholder="Your payment or bank transaction reference"></label><label class="admin-confirm-label"><input name="confirmed" type="checkbox" required><span id="admin-review-confirm-label">I have checked the payment records and verified this payment.</span></label>${formEnd('Confirm decision')}</form>` : '<div class="admin-modal-actions"><button class="button outline" data-admin-close>Close record</button></div>'}`);
  }
  function pickForm() {
    const strategies = state.strategies.filter(strategy => strategy.active !== false && strategy.status !== 'inactive');
    const events = state.events.filter(event => event.status === 'open' && new Date(event.starts_at).getTime() > Date.now());
    openModal(`<span class="section-kicker">COPY DESK / PUBLISH A PICK</span><h2 id="admin-modal-title">LEAD THE NEXT PLAY<span>.</span></h2><p class="admin-modal-description">Choose a strategy and an available market. Publishing creates stakes in eligible active positions using the strategy’s allocation percentage.</p><form id="admin-pick-form"><div class="admin-form-grid">${selectField('strategy_id','Copy strategy',strategies.map(strategy => [strategy.id,strategy.name]),strategies[0]?.id,true)}${selectField('event_id','Game',events.map(event => [event.id,`${event.home_name} vs ${event.away_name}`]),events[0]?.id,true)}<label class="admin-field admin-field-full"><span>Selected outcome</span><select name="outcome" id="admin-pick-outcome"></select></label></div><div class="admin-funding-preview" id="admin-pick-preview"></div><label class="admin-confirm-label"><input type="checkbox" name="confirmed" required><span>I have reviewed this pick and authorize stakes from eligible funded copy positions. These stakes can lose value.</span></label>${formEnd('Publish & copy stakes',Boolean(strategies.length && events.length))}</form>`);
    updatePickForm(true);
  }
  function updatePickForm(resetOutcome = false) {
    const form = $('#admin-pick-form');if (!form) return;
    const strategy = state.strategies.find(item => String(item.id) === form.elements.strategy_id.value);
    const event = state.events.find(item => String(item.id) === form.elements.event_id.value);
    const outcome = form.elements.outcome.value;
    form.elements.outcome.innerHTML = event ? ['home','draw','away'].filter(item => event[`odds_${item}`] != null).map(item => `<option value="${item}">${escape(outcomeName(event,item))} / ${Number(event[`odds_${item}`]).toFixed(2)}</option>`).join('') : '<option>No open games available</option>';
    if (!resetOutcome && [...form.elements.outcome.options].some(option => option.value === outcome)) form.elements.outcome.value = outcome;
    const percent = strategy?.stake_percentage ?? strategy?.allocation_percent;
    $('#admin-pick-preview').innerHTML = event && strategy ? `<strong>${escape(strategy.name)} / ${escape(percent ?? 'Strategy')}% per stake</strong><br>The current odds are locked when the copied stake is placed. Positions that are paused or lack funds are skipped. Publication results are recorded in the activity log.` : 'Create and open a game, and make a copy strategy available, before publishing a pick.';
  }
  async function submit(event) {
    const form = event.target;
    if (!form.closest('#admin-modal-content')) return;
    event.preventDefault();
    if (!canWrite()) return modalError(new Error('Read-only preview. Sign in to the Laravel app as an administrator to make changes.'));
    if (form.id === 'admin-payment-settings-form') return savePaymentSettings(form);
    if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form).entries());
    if (form.id === 'admin-event-form') {
      const payload = {sport:data.sport,league:data.league.trim(),country:data.country.trim(),home_name:data.home_name.trim(),away_name:data.away_name.trim(),starts_at:new Date(data.starts_at).toISOString(),status:data.status,odds_home:Number(data.odds_home),odds_draw:data.odds_draw === '' ? null : Number(data.odds_draw),odds_away:Number(data.odds_away)};
      if (payload.home_name.toLowerCase() === payload.away_name.toLowerCase()) return modalError(new Error('The home and away teams must be different.'));
      const id = form.dataset.eventId;
      if (id && form.dataset.version) payload.version = Number(form.dataset.version);
      await mutate(`/api/admin/events${id ? `/${id}` : ''}`,payload,id ? 'PATCH' : 'POST',id ? 'Game and odds updated. Existing stakes retain their accepted odds.' : 'Game created. Open its market when the schedule and odds are ready.');
    } else if (form.id === 'admin-score-form') {
      const selected = state.events.find(item => Number(item.id) === Number(form.dataset.eventId));
      if (!selected || final(selected) || new Date(selected.starts_at).getTime() > Date.now()) return modalError(new Error('Final scores can only be published after the scheduled game start.'));
      const home = Number(data.home_score), away = Number(data.away_score);
      if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0) return modalError(new Error('Enter whole-number final scores of zero or more.'));
      confirmResult(Number(form.dataset.eventId),home,away);
    } else if (form.id === 'admin-confirm-result-form') {
      if (!scoreDraft || Number(form.dataset.eventId) !== Number(scoreDraft.id)) return;
      await mutate(`/api/admin/events/${scoreDraft.id}/result`,{home_score:scoreDraft.home,away_score:scoreDraft.away},'POST','Final score published. Eligible stakes and copy stakes have been settled.');
    } else if (form.id === 'admin-void-form') {
      await mutate(`/api/admin/events/${form.dataset.eventId}/void`,{reason:data.reason.trim()},'POST','Game voided. Related stakes have been processed using the void rules.');
    } else if (form.id === 'admin-review-form') {
      await mutate(`/api/admin/wallet-requests/${form.dataset.requestId}/review`,{decision:data.decision,reference:data.reference.trim(),...(data.decision === 'reject' ? {reason:data.reference.trim()} : {})},'POST',`Payment request ${data.decision === 'approve' ? 'approved' : 'rejected'}. The decision is recorded.`);
    } else if (form.id === 'admin-pick-form') {
      const response = await mutate('/api/admin/copy-picks',{strategy_id:Number(data.strategy_id),event_id:Number(data.event_id),outcome:data.outcome},'POST','Copy pick published. Eligible positions have been processed.');
      if (response) {const result = response.data || response;const copied = result.copied ?? result.copied_count ?? result.pick?.copied_count;if (copied != null) feedback(`Copy pick published. ${copied} eligible ${Number(copied) === 1 ? 'position' : 'positions'} copied.`);}
    }
  }
  function change(event) {
    if (event.target.id === 'admin-event-status') renderEvents();
    if (event.target.id === 'admin-request-status') renderRequests();
    if (event.target.closest('#admin-pick-form')) updatePickForm(event.target.name === 'event_id');
    if (event.target.name === 'stripe_mode' && event.target.closest('#admin-payment-settings-form')) {
      const badge = $('#admin-stripe-mode-label');
      badge.textContent = event.target.value === 'live' ? 'LIVE MODE' : 'SANDBOX / TEST';
      badge.classList.toggle('live',event.target.value === 'live');
    }
    if (event.target.name === 'decision' && event.target.closest('#admin-review-form')) {
      const rejected = event.target.value === 'reject';
      $('#admin-review-reference-label').textContent = rejected ? 'Reason for rejection' : 'Verified payment reference';
      $('#admin-review-reference').placeholder = rejected ? 'Explain why this request is being rejected' : 'Your payment or bank transaction reference';
      $('#admin-review-reference').minLength = rejected ? 5 : 3;
      $('#admin-review-confirm-label').textContent = rejected ? 'I have reviewed this request and recorded the reason for rejecting it.' : 'I have checked the payment records and verified this payment.';
      if (rejected) $('#admin-review-effect').textContent = 'A rejected deposit does not credit the wallet. A rejected withdrawal returns its reserved funds to the user’s available balance.';
      else {const item = state.requests.find(item => Number(item.id) === Number($('#admin-review-form').dataset.requestId));$('#admin-review-effect').textContent = item?.type === 'deposit' ? 'Approval credits the verified deposit amount to the user’s wallet. Confirm receipt with your payment records first.' : 'Approval records a completed payout. This action does not send a bank transfer.';}
    }
  }
  function click(event) {
    const button = event.target.closest('button');if (!button) return;
    if (button.hasAttribute('data-admin-close')) closeModal();
    if (button.hasAttribute('data-admin-new-event')) eventForm();
    if (button.hasAttribute('data-admin-edit')) eventForm(button.dataset.adminEdit);
    if (button.hasAttribute('data-admin-result')) scoreForm(button.dataset.adminResult);
    if (button.hasAttribute('data-admin-void')) voidForm(button.dataset.adminVoid);
    if (button.hasAttribute('data-admin-review')) reviewForm(button.dataset.adminReview);
    if (button.hasAttribute('data-admin-new-pick')) pickForm();
    if (button.hasAttribute('data-admin-edit-settings')) paymentSettingsForm();
    if (button.hasAttribute('data-admin-retry-settings')) loadPaymentSettings(true);
    if (button.hasAttribute('data-admin-tab')) selectTab(button.dataset.adminTab);
    if (button.id === 'admin-refresh') {refresh();if (state.tab === 'settings') loadPaymentSettings(true);}
    if (button.hasAttribute('data-admin-signin')) {if (window.EdgeAPI?.openAuth) window.EdgeAPI.openAuth('login');else window.dispatchEvent(new CustomEvent('edge:auth',{detail:{mode:'login'}}));}
  }
  function keydown(event) {
    const modal = $('#admin-modal');
    if (!modal.hidden) {
      if (event.key === 'Escape') {event.preventDefault();closeModal();}
      if (event.key === 'Tab') {
        const elements = $$('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]',modal).filter(element => !element.hidden);
        const first = elements[0],last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) {event.preventDefault();last?.focus();}
        else if (!event.shiftKey && document.activeElement === last) {event.preventDefault();first?.focus();}
      }
    }
    const tab = event.target.closest('[data-admin-tab]');
    if (tab && ['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
      event.preventDefault();const tabs = $$('[data-admin-tab]');let index = tabs.indexOf(tab);
      index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length-1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
      selectTab(tabs[index].dataset.adminTab);tabs[index].focus();
    }
  }
  function init() {
    root = $('#admin-page');if (!root || initialized) return;
    initialized = true;
    root.addEventListener('click',click);
    root.addEventListener('submit',submit);
    root.addEventListener('change',change);
    $('#admin-event-search').addEventListener('input',renderEvents);
    $('#admin-modal').addEventListener('click',event => {if (event.target.id === 'admin-modal') closeModal();});
    document.addEventListener('keydown',keydown);
    window.addEventListener('edge:session',event => applySession(event.detail || {}));
    window.addEventListener('edge:navigate',event => {if (event.detail?.page === 'admin' && canWrite()) refresh();else if (event.detail?.page !== 'admin') closeModal();});
    selectTab('events');
    applySession({user:window.EdgeAPI?.user || null,serverMode:window.EdgeAPI?.serverMode === true});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init);else init();
})();
