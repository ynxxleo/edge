(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  const icon = name => `<svg aria-hidden="true"><use href="#i-${escape(name)}"/></svg>`;
  const statuses = ['not_submitted','pending','approved','rejected','additional_required'];
  const countryCodes = 'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' ');
  const regionNames = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'],{type:'region'}) : null;
  const countryName = code => regionNames?.of(code) || code;
  const labels = {not_submitted:'Not submitted',pending:'Pending review',approved:'Verified',rejected:'Changes needed',additional_required:'Additional checks required'};
  const state = {serverMode:false,user:null,summary:null,customerLoading:false,customerError:'',adminTab:false,adminLoading:false,submissions:[],pagination:{current_page:1,last_page:1,total:0},review:null,decision:null,submitting:false,section:'reviews',settings:null,savedLayers:[],settingsLoading:false,settingsSaving:false,users:[],usersLoading:false,usersPagination:{current_page:1,last_page:1,total:0},assignment:null,assignmentLoading:false,assignmentSaving:false};
  let initialized = false, customerSerial = 0, adminSerial = 0, detailSerial = 0, settingsSerial = 0, usersSerial = 0, assignmentSerial = 0, returnFocus = null;
  const maxFileBytes = 2 * 1024 * 1024;
  const signedIn = () => state.serverMode && Boolean(state.user?.id);
  const isAdmin = () => signedIn() && state.user?.is_admin === true;
  const activeCustomer = () => !$('#verification-page')?.hidden;
  const activeAdmin = () => state.adminTab && !$('#admin-page')?.hidden;
  const statusOf = value => statuses.includes(value) ? value : 'not_submitted';
  const badge = status => `<span class="kyc-status-badge ${statusOf(status)}">${labels[statusOf(status)]}</span>`;
  const date = value => {const d = new Date(value);return value && !Number.isNaN(d.getTime()) ? new Intl.DateTimeFormat('en-US',{day:'numeric',month:'short',year:'numeric'}).format(d) : '—';};
  const errorText = error => error?.errors ? Object.values(error.errors).flat().join(' ') : error?.message || 'This request could not be completed. Please try again.';
  const summary = value => ({status:statusOf(value?.status),submission_id:Number(value?.submission_id) || null,version:Number(value?.version) || null,submitted_at:value?.submitted_at || null,reviewed_at:value?.reviewed_at || null,review_note:String(value?.review_note || ''),reason:String(value?.reason || ''),requirements:value?.requirements || null,requirements_changed:value?.requirements_changed === true});
  const safeKey = value => /^[a-z][a-z0-9_]{0,39}$/.test(String(value || ''));
  const layersOf = value => Array.isArray(value?.layers) ? value.layers.filter(layer => layer && typeof layer === 'object' && safeKey(layer.id) && Array.isArray(layer.fields)).map(layer => ({...layer,fields:layer.fields.filter(field => field && typeof field === 'object' && safeKey(field.key))})) : [];
  function renderReason() {
    const notice = $('#kyc-reason-notice');if (!notice) return;
    const current = signedIn() ? state.summary : null;
    const reason = current?.reason || '', personal = current?.requirements?.reason || '';
    notice.hidden = !reason && !personal;
    notice.innerHTML = `${reason ? `<div><span class="section-kicker">WHY WE ASK FOR VERIFICATION</span><p>${escape(reason)}</p></div>` : ''}${personal ? `<div><span class="section-kicker">A NOTE ABOUT YOUR ACCOUNT</span><p>${escape(personal)}</p></div>` : ''}`;
  }
  function customFieldsMarkup(disabled) {
    const off = disabled ? ' disabled' : '';
    return layersOf(state.summary?.requirements).map((layer,index) => `<fieldset class="kyc-extra-layer"><legend><span>${String(index + 1).padStart(2,'0')}</span>${escape(layer.name || layer.id)}</legend>${layer.reason ? `<p>${escape(layer.reason)}</p>` : ''}<div class="kyc-form-grid">${layer.fields.filter(field => safeKey(field.key)).map(field => {
      const name = `answers[${layer.id}][${field.key}]`, label = `${escape(field.label || field.key)}${field.required ? ' <span class="kyc-required" aria-hidden="true">*</span>' : ' <small>(optional)</small>'}`, required = field.required ? ' required' : '';
      if (field.type === 'checkbox') return `<label class="kyc-consent kyc-field-full kyc-layer-checkbox"><input type="checkbox" name="${name}" value="1" data-kyc-answer-checkbox${required}${off}><span>${label}</span></label>`;
      if (field.type === 'file') return `<label class="kyc-upload kyc-field-full"><strong>${label}</strong><small>JPG, PNG or PDF · up to 2 MB</small><input type="file" name="${name}" accept="image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf"${required}${off}><span class="kyc-file-feedback" data-kyc-file-feedback="${name}"></span></label>`;
      if (field.type === 'textarea') return `<label class="kyc-field kyc-field-full"><span>${label}</span><textarea name="${name}" rows="3" maxlength="3000"${required}${off}></textarea></label>`;
      if (field.type === 'select') return `<label class="kyc-field"><span>${label}</span><select name="${name}"${required}${off}><option value="">Choose an option</option>${(Array.isArray(field.options) ? field.options : []).map(option => `<option value="${escape(option)}">${escape(option)}</option>`).join('')}</select></label>`;
      return `<label class="kyc-field"><span>${label}</span><input name="${name}" type="${field.type === 'date' ? 'date' : 'text'}"${field.type === 'date' ? '' : ' maxlength="500"'}${required}${off}></label>`;
    }).join('')}</div></fieldset>`).join('');
  }
  async function request(path, options = {}) {
    if (!signedIn() || !window.EdgeAPI?.request) throw new Error('Sign in to the Laravel app to manage identity verification.');
    return window.EdgeAPI.request(path, options);
  }
  function message(selector, text, error = false) {
    const element = $(selector);if (!element) return;
    element.textContent = text;element.classList.toggle('error',error);element.hidden = !text;
  }
  function go(page) {
    if (window.EdgeAPI?.navigate) window.EdgeAPI.navigate(page);
    else window.location.hash = page;
  }
  function formMarkup(disabled = false) {
    const off = disabled ? ' disabled' : '';
    const maxBirthDate = new Date();maxBirthDate.setFullYear(maxBirthDate.getFullYear() - 18);
    const maxDOB = `${maxBirthDate.getFullYear()}-${String(maxBirthDate.getMonth()+1).padStart(2,'0')}-${String(maxBirthDate.getDate()).padStart(2,'0')}`;
    const field = (name,label,options = '') => `<label class="kyc-field"><span>${label}</span><input name="${name}" ${options}${off}></label>`;
    return `<article class="kyc-form-card"><div class="kyc-form-heading"><div><span class="section-kicker">IDENTITY / A LITTLE ABOUT YOU</span><h2>Your next step<span>.</span></h2><p>Use the details on your identity document. You must be at least 18 years old.</p></div><span class="kyc-form-step">01 — 02 — 03</span></div><form id="kyc-submit-form" enctype="multipart/form-data" autocomplete="off">${Number.isInteger(state.summary?.requirements?.version) ? `<input type="hidden" name="requirements_version" value="${state.summary.requirements.version}"${off}>` : ''}<div class="kyc-form-grid">${field('legal_name','Full legal name','type="text" required minlength="2" maxlength="160" autocomplete="name" placeholder="As shown on your document"')}${field('date_of_birth','Date of birth',`type="date" required min="1900-01-01" max="${maxDOB}"`)}<label class="kyc-field"><span>Country of residence</span><select name="country" required${off}><option value="">Choose your country</option>${countryCodes.slice().sort((a,b) => countryName(a).localeCompare(countryName(b))).map(code => `<option value="${code}">${escape(countryName(code))}</option>`).join('')}</select></label><label class="kyc-field"><span>Identity document</span><select name="document_type" required${off}><option value="">Choose document type</option><option value="passport">Passport</option><option value="national_id">National identity card</option><option value="drivers_license">Driver’s licence</option></select></label>${field('document_number','Document number','type="text" required minlength="3" maxlength="80" spellcheck="false"')}<label class="kyc-field kyc-field-full"><span>Residential address</span><textarea name="address" rows="3" required minlength="10" maxlength="1000" autocomplete="street-address" placeholder="Street address, city, state and postal code"${off}></textarea></label></div><div class="kyc-document-section"><h3>A clear picture. A quicker review.</h3><p>Upload the full document with all corners visible, plus a recent, clear selfie. All files together must be 6 MB or less.</p><div class="kyc-upload-grid"><label class="kyc-upload"><span class="kyc-upload-icon">${icon('plus')}</span><strong>Identity document</strong><small>JPG, PNG or PDF · up to 2 MB</small><input type="file" name="id_document" accept="image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf" required${off}><span class="kyc-file-feedback" data-kyc-file-feedback="id_document"></span></label><label class="kyc-upload"><span class="kyc-upload-icon">${icon('plus')}</span><strong>Your selfie</strong><small>JPG or PNG · up to 2 MB</small><input type="file" name="selfie" accept="image/jpeg,image/png,.jpg,.jpeg,.png" required${off}><span class="kyc-file-feedback" data-kyc-file-feedback="selfie"></span></label></div></div>${customFieldsMarkup(disabled)}<label class="kyc-consent"><input type="checkbox" name="consent" value="1" required${off}><span>I confirm that these details and documents belong to me. I consent to <strong>private administrator review</strong> of this information to verify my identity and enable withdrawals.</span></label><div id="kyc-submit-error" class="kyc-message error" role="alert" hidden></div><div class="kyc-form-footer"><span>${icon('lock')} PRIVATE DOCUMENTS / ADMIN REVIEW</span><button type="submit" class="button green" data-kyc-submit${off}>Submit for review ${icon('arrow')}</button></div></form></article>`;
  }
  function renderCustomer() {
    const container = $('#kyc-customer-content');if (!container) return;renderReason();
    $('#kyc-preview-notice').hidden = state.serverMode;
    if (!state.serverMode) {container.innerHTML = formMarkup(true);return;}
    if (!signedIn()) {container.innerHTML = `<div class="kyc-empty">${icon('lock')}<h2>Your identity. Your control.</h2><p>Sign in to submit your identity documents for administrator review.</p><button class="button green" data-kyc-signin>Sign in ${icon('arrow')}</button></div>`;return;}
    if (state.customerLoading) {container.innerHTML = '<div class="kyc-customer-loading" role="status"><span class="kyc-submit-spinner" aria-hidden="true"></span>Loading your verification status…</div>';return;}
    if (state.customerError) {container.innerHTML = `<div class="kyc-empty">${icon('lock')}<h2>Let’s try that again.</h2><p>${escape(state.customerError)}</p><button class="button green" data-kyc-refresh>Refresh status ${icon('clock')}</button></div>`;return;}
    const current = state.summary || summary(state.user?.kyc || {status:state.user?.kyc_status});
    if (current.status === 'not_submitted') {container.innerHTML = formMarkup();return;}
    if (current.status === 'additional_required') {container.innerHTML = `<div class="kyc-message"><strong>Additional verification is required.</strong><br>Your administrator has updated the checks for your account. Complete the current form below, including the additional sections. Withdrawals are available after approval of these requirements.</div>${formMarkup()}`;return;}
    const content = {
      pending:{symbol:'clock',title:'You’re in the review queue.',text:'Your documents have been submitted. An administrator will review your identity before you can request a withdrawal.'},
      approved:{symbol:'check',title:'You’re verified. Ready to move.',text:'Your identity has been approved. You can now request withdrawals from your available wallet balance.'},
      rejected:{symbol:'lock',title:'A few details need another look.',text:'Please review the administrator’s note and submit updated details and documents.'}
    }[current.status];
    const documents = current.submission_id ? `<a href="/api/kyc/${current.submission_id}/documents/id_document" download>Download your ID</a><a href="/api/kyc/${current.submission_id}/documents/selfie" download>Download your selfie</a>` : '';
    container.innerHTML = `<div class="kyc-empty ${current.status}" id="kyc-status">${icon(content.symbol)}<div>${badge(current.status)}</div><h2>${content.title}</h2><p>${content.text}</p>${current.status === 'rejected' && current.review_note ? `<p class="kyc-status-note"><strong>Administrator’s note</strong><br>${escape(current.review_note)}</p>` : ''}<span class="kyc-status-date">${current.reviewed_at ? `Reviewed ${escape(date(current.reviewed_at))}` : `Submitted ${escape(date(current.submitted_at))}`}</span><div class="kyc-status-actions">${current.status === 'approved' ? `<button class="button green" data-kyc-wallet>Go to wallet ${icon('arrow')}</button>` : current.status === 'rejected' ? `<button class="button green" data-kyc-resubmit>Update & resubmit ${icon('arrow')}</button>` : `<button class="button outline" data-kyc-refresh>Refresh status ${icon('clock')}</button>`}</div><div class="kyc-status-actions">${documents}</div></div>`;
  }
  async function loadCustomer() {
    if (!signedIn()) {renderCustomer();return;}
    if (state.customerLoading) return;
    const serial = ++customerSerial;state.customerLoading = true;state.customerError = '';renderCustomer();
    try {
      const response = await request('/api/kyc');
      if (serial !== customerSerial || !signedIn()) return;
      if (!response?.kyc || !statuses.includes(response.kyc.status)) throw new Error('Your verification status could not be loaded.');
      state.summary = summary(response.kyc);
    } catch (error) {if (serial === customerSerial && signedIn()) state.customerError = errorText(error);}
    finally {if (serial === customerSerial) {state.customerLoading = false;renderCustomer();renderWalletNotice();}}
  }
  function validateFile(input, report = true) {
    const file = input.files?.[0];const allowed = input.name === 'selfie' ? ['image/jpeg','image/png'] : ['image/jpeg','image/png','application/pdf'];
    let error = '';
    if (!file && input.required) error = 'Choose a file to upload.';
    else if (file && file.size > maxFileBytes) error = 'This file is too large. Choose a file up to 2 MB.';
    else if (file && !allowed.includes(file.type)) error = input.name === 'selfie' ? 'Choose a JPG or PNG image.' : 'Choose a JPG, PNG or PDF file.';
    input.setCustomValidity(error);
    if (report) {const feedback = $$('[data-kyc-file-feedback]').find(item => item.dataset.kycFileFeedback === input.name);if (feedback) {feedback.textContent = error || (file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB` : '');feedback.classList.toggle('error',Boolean(error));}}
    return !error;
  }
  async function submitCustomer(form) {
    if (!signedIn() || state.submitting) return;
    let filesValid = true;$$('input[type="file"]',form).forEach(input => {if (!validateFile(input)) filesValid = false;});
    if (!filesValid || !form.reportValidity()) return;
    if ($$('input[type="file"]',form).reduce((total,input) => total + (input.files?.[0]?.size || 0),0) > 6 * 1024 * 1024) {message('#kyc-submit-error','All uploads together must be 6 MB or less. Choose smaller files before submitting.',true);return;}
    const body = new FormData(form);body.set('country',String(body.get('country') || '').trim().toUpperCase());
    $$('[data-kyc-answer-checkbox]',form).forEach(input => body.set(input.name,input.checked ? '1' : '0'));
    $$('input[type="file"]',form).forEach(input => {if (!input.files?.length) body.delete(input.name);});
    const serial = customerSerial;const account = state.user.id;
    state.submitting = true;
    form.closest('.kyc-form-card').setAttribute('aria-busy','true');
    const controls = $$('input,select,textarea,button',form);controls.forEach(control => control.disabled = true);
    const button = $('[data-kyc-submit]',form);button.innerHTML = '<span class="kyc-submit-spinner" aria-hidden="true"></span> Submitting documents…';message('#kyc-submit-error','');
    try {
      const response = await request('/api/kyc',{method:'POST',body});
      if (serial !== customerSerial || state.user?.id !== account) return;
      if (response?.kyc?.status !== 'pending') throw new Error('Your submission status could not be confirmed. Refresh before trying again.');
      form.reset();state.summary = summary(response.kyc);state.customerError = '';state.user = {...state.user,kyc_status:'pending',kyc:response.kyc};renderCustomer();renderWalletNotice();
      window.dispatchEvent(new CustomEvent('edge:kyc-updated',{detail:{kyc:response.kyc}}));
    } catch (error) {if (serial === customerSerial && state.user?.id === account) {message('#kyc-submit-error',errorText(error),true);if (Number(error?.status) === 409 || /requirements|revision|version|out.of.date/i.test(errorText(error))) {const button = document.createElement('button');button.type = 'button';button.className = 'admin-small-button';button.dataset.kycRefresh = '';button.textContent = 'Reload latest form (clears entered details)';$('#kyc-submit-error').append(document.createElement('br'),button);}}}
    finally {if (serial === customerSerial && state.user?.id === account) state.submitting = false;if (form.isConnected) {controls.forEach(control => control.disabled = false);button.innerHTML = `Submit for review ${icon('arrow')}`;form.closest('.kyc-form-card')?.setAttribute('aria-busy','false');}}
  }
  function renderWalletNotice() {
    const wallet = $('#wallet-page');if (!wallet) return;
    let notice = $('#kyc-wallet-notice');
    if (!signedIn()) {notice?.remove();return;}
    if (!notice) {notice = document.createElement('div');notice.id = 'kyc-wallet-notice';notice.className = 'kyc-wallet-notice';wallet.prepend(notice);}
    const current = statusOf(state.summary?.status || state.user?.kyc_status || state.user?.kyc?.status);
    if (current === 'approved') {notice.innerHTML = `${icon('check')}<div><strong>Identity verified</strong><span>Your account is approved for withdrawal requests.</span></div>${badge('approved')}`;notice.classList.add('approved');}
    else {const detail = current === 'pending' ? 'Your documents are awaiting administrator review.' : current === 'rejected' ? 'Review the administrator’s note and resubmit your documents.' : 'Complete identity verification before requesting a withdrawal.';notice.innerHTML = `${icon('lock')}<div><strong>Verification required for withdrawals</strong><span>${detail}</span></div><button class="button outline" data-kyc-open>${current === 'pending' ? 'View status' : current === 'rejected' ? 'Update documents' : 'Verify identity'} ${icon('arrow')}</button>`;notice.classList.remove('approved');}
  }
  function renderAdmin() {
    const list = $('#kyc-review-list');if (!list) return;
    $('#kyc-review-refresh').disabled = state.adminLoading;
    if (!state.serverMode) {list.innerHTML = '<div class="kyc-empty"><h2>Private by design.</h2><p>Real identity submissions are available only in the Laravel app with an administrator account. No documents can be reviewed in this preview.</p></div>';$('#kyc-review-pagination').hidden = true;return;}
    if (!isAdmin()) {list.innerHTML = '';$('#kyc-review-pagination').hidden = true;return;}
    if (state.adminLoading) {list.innerHTML = '<div class="kyc-customer-loading" role="status"><span class="kyc-submit-spinner" aria-hidden="true"></span>Loading verification requests…</div>';return;}
    list.innerHTML = state.submissions.length ? state.submissions.map(item => `<article class="kyc-review-row"><div class="kyc-review-person"><strong>${escape(item.user?.name || 'Account holder')}</strong><span>${escape(item.user?.email || '')}<br>SUBMISSION #${escape(item.id)}</span></div><div class="kyc-review-meta">${badge(item.status)}${item.requirements_changed ? '<small class="kyc-superseded-label">Earlier requirements</small>' : ''}<small>${escape(date(item.submitted_at))}</small></div><button class="button outline" data-kyc-review="${escape(item.id)}">${item.status === 'pending' && !item.requirements_changed ? 'Review identity' : 'View submission'} ${icon('arrow')}</button></article>`).join('') : `<div class="kyc-empty">${icon('check')}<h2>${$('#kyc-review-status').value === 'pending' ? 'All clear at the identity desk.' : 'No submissions here yet.'}</h2><p>${$('#kyc-review-status').value === 'pending' ? 'New identity submissions will appear here for your review.' : 'Try another verification status.'}</p></div>`;
    const page = state.pagination;
    $('#kyc-review-pagination').hidden = Number(page.last_page) <= 1;
    $('#kyc-review-page-label').textContent = `Page ${page.current_page} of ${page.last_page} · ${page.total} submissions`;
    $('[data-kyc-page="previous"]').disabled = Number(page.current_page) <= 1;
    $('[data-kyc-page="next"]').disabled = Number(page.current_page) >= Number(page.last_page);
  }
  async function loadAdmin(page = 1) {
    if (!isAdmin()) {renderAdmin();return;}
    const serial = ++adminSerial;state.adminLoading = true;message('#kyc-admin-message','');renderAdmin();
    const filter = $('#kyc-review-status')?.value || 'pending';
    try {
      const response = await request(`/api/admin/kyc?status=${encodeURIComponent(filter)}&page=${Math.max(1,Number(page) || 1)}`);
      if (serial !== adminSerial || !isAdmin() || !activeAdmin()) return;
      state.submissions = Array.isArray(response?.submissions) ? response.submissions : [];
      state.pagination = response?.pagination || {current_page:1,last_page:1,total:state.submissions.length};
    } catch (error) {if (serial === adminSerial && isAdmin()) {state.submissions = [];message('#kyc-admin-message',errorText(error),true);}}
    finally {if (serial === adminSerial) {state.adminLoading = false;renderAdmin();}}
  }
  function documentLink(record, kind, label) {
    if (!/^[a-z0-9_]{1,100}$/.test(kind)) return '';
    const attachment = record.documents?.[kind];if (!attachment) return '';
    const expected = `/api/kyc/${Number(record.id)}/documents/${kind}`;
    let url;try {url = new URL(attachment.download_url,window.location.origin);} catch {return '';}
    if (url.origin !== window.location.origin || url.pathname !== expected || url.search || url.hash) return '';
    const type = {'image/jpeg':'JPG image','image/png':'PNG image','application/pdf':'PDF document'}[attachment.mime_type] || 'Private file';
    const size = Math.max(0,Number(attachment.size) || 0);
    return `<a class="kyc-review-document" href="${escape(expected)}" download>${icon('arrow')}<span><strong>Download ${escape(label)}</strong><small>${type} · ${(size / 1024 / 1024).toFixed(2)} MB</small></span></a>`;
  }
  function reviewLayersMarkup(record) {
    const requirements = record.requirements || {};
    const context = requirements.global_reason || requirements.reason ? `<div class="kyc-review-context-note"><strong>Reason shown at submission</strong>${requirements.global_reason ? `<p>${escape(requirements.global_reason)}</p>` : ''}${requirements.reason ? `<p>${escape(requirements.reason)}</p>` : ''}</div>` : '';
    return context + layersOf(requirements).map(layer => `<section class="kyc-review-layer"><h3>${escape(layer.name || layer.id)}</h3>${layer.reason ? `<p>${escape(layer.reason)}</p>` : ''}<dl class="kyc-review-details">${layer.fields.map(field => {
      const value = record.answers?.[layer.id]?.[field.key];
      const rendered = field.type === 'file' ? (value?.document_kind ? documentLink(record,value.document_kind,String(field.label || field.key)) : 'Not supplied') : escape(field.type === 'checkbox' ? (value === true || value === 1 || value === '1' ? 'Yes' : 'No') : value ?? 'Not supplied');
      return `<div class="full"><dt>${escape(field.label || field.key)}</dt><dd>${rendered}</dd></div>`;
    }).join('')}</dl></section>`).join('');
  }
  function reviewMarkup(record) {
    const detail = (label,value,full = false) => `<div${full ? ' class="full"' : ''}><dt>${label}</dt><dd>${escape(value || '—')}</dd></div>`;
    const documentNames = {passport:'Passport',national_id:'National identity card',drivers_license:'Driver’s licence'};
    const self = Number(record.user?.id) === Number(state.user?.id);
    const reviewForm = record.requirements_changed ? '<p class="kyc-review-blocked">This submission uses earlier requirements and cannot be approved. The user must submit the current verification form. This record is available as read-only history.</p>' : record.status === 'pending' ? self ? '<p class="kyc-review-blocked">You cannot review your own identity submission. Another administrator must review this request.</p>' : `<form id="kyc-review-form" autocomplete="off"><div class="kyc-review-options"><label><input type="radio" name="decision" value="approved" required> Approve identity</label><label><input type="radio" name="decision" value="rejected" required> Request changes</label></div><label class="kyc-field"><span id="kyc-review-note-label">Review note (optional for approval)</span><textarea name="review_note" rows="3" maxlength="1500" placeholder="Explain any changes needed. This note is visible to the user."></textarea><small>Notes must have at least 10 characters. A clear reason is required when requesting changes.</small></label><label class="kyc-consent"><input name="confirm_review" type="checkbox" required><span>I have reviewed the supplied details, identity document and selfie, and confirm this decision is accurate.</span></label><div class="kyc-review-dialog-actions"><button type="button" class="button outline" data-kyc-close>Cancel</button><button id="kyc-review-confirm-submit" class="button green" type="submit">Continue ${icon('arrow')}</button></div></form><div id="kyc-review-confirmation" hidden></div>` : `<div class="kyc-reviewed-record">Reviewed ${escape(date(record.reviewed_at))}${record.review_note ? `<br><strong>Review note</strong><br>${escape(record.review_note)}` : ''}</div>`;
    return `<span class="section-kicker">IDENTITY DESK / SUBMISSION #${escape(record.id)}</span><h2 id="kyc-review-title">CHECK. CONFIRM<span>.</span></h2><p class="kyc-review-person-heading">${escape(record.user?.name || 'Account holder')}<br>${escape(record.user?.email || '')}</p>${badge(record.status)}<div class="kyc-sensitive-warning">${icon('lock')}<span>Confidential identity information. Use these details only to review this account’s verification request.</span></div><dl class="kyc-review-details">${detail('Full legal name',record.legal_name)}${detail('Date of birth',record.date_of_birth)}${detail('Country of residence',record.country)}${detail('Document type',documentNames[record.document_type] || record.document_type)}${detail('Document number',record.document_number)}${detail('Submitted',date(record.submitted_at))}${detail('Residential address',record.address,true)}</dl><div class="kyc-review-documents">${documentLink(record,'id_document','identity document')}${documentLink(record,'selfie','selfie')}</div>${reviewLayersMarkup(record)}<div class="kyc-message error" id="kyc-review-error" role="alert" hidden></div>${reviewForm}`;
  }
  async function openReview(id, trigger) {
    if (!isAdmin() || !activeAdmin()) return;
    closeReview(false);returnFocus = trigger;
    const serial = ++detailSerial;
    $('#kyc-review-dialog').hidden = false;
    document.body.classList.add('kyc-review-open');
    $('#kyc-review-content').innerHTML = '<h2 id="kyc-review-title">OPENING FILE<span>.</span></h2><div class="kyc-customer-loading"><span class="kyc-submit-spinner" aria-hidden="true"></span>Loading the private submission…</div>';
    $('[data-kyc-close]',$('#kyc-review-dialog')).focus();
    try {
      const response = await request(`/api/admin/kyc/${Number(id)}`);
      if (serial !== detailSerial || !isAdmin() || !activeAdmin()) return;
      const record = response?.submission;
      if (!record || Number(record.id) !== Number(id)) throw new Error('The identity submission could not be loaded.');
      state.review = record;$('#kyc-review-content').innerHTML = reviewMarkup(record);
    } catch (error) {if (serial === detailSerial && isAdmin()) $('#kyc-review-content').innerHTML = `<h2 id="kyc-review-title">LET’S TRY AGAIN<span>.</span></h2><div class="kyc-message error" role="alert">${escape(errorText(error))}</div><button class="button outline" data-kyc-close>Close review</button>`;}
  }
  function closeReview(restoreFocus = true) {
    detailSerial++;state.review = null;state.decision = null;
    document.body.classList.remove('kyc-review-open');
    if ($('#kyc-review-dialog')) $('#kyc-review-dialog').hidden = true;
    if ($('#kyc-review-content')) $('#kyc-review-content').innerHTML = '';
    if (restoreFocus && returnFocus?.isConnected) returnFocus.focus();
    returnFocus = null;
  }
  function confirmReview(form) {
    if (!isAdmin() || state.review?.status !== 'pending') return;
    const data = new FormData(form);const decision = data.get('decision');const note = String(data.get('review_note') || '').trim();
    const reason = $('[name="review_note"]',form);reason.setCustomValidity((decision === 'rejected' || note.length > 0) && note.length < 10 ? 'Use at least 10 characters for the review note, or leave it blank when approving.' : '');
    if (!form.reportValidity()) return;
    if (!['approved','rejected'].includes(decision) || !data.get('confirm_review')) return;
    state.decision = {version:Number(state.review.version),decision,review_note:note};
    form.hidden = true;message('#kyc-review-error','');
    const confirmation = $('#kyc-review-confirmation');confirmation.hidden = false;
    confirmation.innerHTML = `<div class="kyc-review-confirmation"><h3>${decision === 'approved' ? 'Approve this identity?' : 'Request updated documents?'}</h3><p>${decision === 'approved' ? 'This account will be eligible to request withdrawals. Confirm that the documents and identity details match.' : 'The user will see your note and can submit a new identity check. Withdrawals remain locked until approval.'}</p>${note ? `<blockquote>${escape(note)}</blockquote>` : ''}<div class="kyc-review-dialog-actions"><button class="button outline" data-kyc-back>Back</button><button class="button green" id="kyc-decision-confirm">${decision === 'approved' ? 'Confirm approval' : 'Confirm rejection'} ${icon('check')}</button></div></div>`;
    $('#kyc-decision-confirm').focus();
  }
  async function saveReview() {
    if (!isAdmin() || !state.review || !state.decision) return;
    const button = $('#kyc-decision-confirm');if (button?.disabled) return;
    const id = Number(state.review.id), serial = detailSerial;
    const controls = $$('button,input,textarea',$('#kyc-review-content'));controls.forEach(control => control.disabled = true);
    button.innerHTML = '<span class="kyc-submit-spinner" aria-hidden="true"></span> Saving decision…';
    try {
      await request(`/api/admin/kyc/${id}/review`,{method:'POST',body:JSON.stringify(state.decision),headers:{'Content-Type':'application/json'}});
      if (serial !== detailSerial || !isAdmin()) return;
      closeReview();await loadAdmin(state.pagination.current_page);message('#kyc-admin-message','Identity review recorded. The account’s verification status has been updated.');
      window.dispatchEvent(new CustomEvent('edge:kyc-updated',{detail:{submission_id:id,adminReview:true}}));
    } catch (error) {if (serial === detailSerial && isAdmin()) {message('#kyc-review-error',errorText(error),true);controls.forEach(control => control.disabled = false);button.textContent = state.decision?.decision === 'approved' ? 'Confirm approval' : 'Confirm rejection';}}
  }
  const activeRequirements = () => activeAdmin() && isAdmin() && state.section === 'requirements';
  const newKey = prefix => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`;
  function fieldEditorMarkup(field,index,layerIndex) {
    const type = ['text','textarea','date','select','checkbox','file'].includes(field.type) ? field.type : 'text';
    return `<div class="kyc-field-editor" data-kyc-field="${index}" data-field-key="${escape(field.key)}"><div class="kyc-field-editor-heading"><span>FIELD ${String(index + 1).padStart(2,'0')} </span><button type="button" class="kyc-text-button danger" data-kyc-remove-field="${layerIndex}:${index}" aria-label="Remove field ${index + 1} from layer ${layerIndex + 1}">Remove field</button></div><div class="kyc-builder-grid"><label class="kyc-field"><span>Field label</span><input type="text" data-kyc-field-label value="${escape(field.label)}" required minlength="2" maxlength="150" placeholder="For example: Source of funds"></label><label class="kyc-field"><span>Input type</span><select data-kyc-field-type>${[['text','Short answer'],['textarea','Long answer'],['date','Date'],['select','Dropdown'],['checkbox','Confirmation'],['file','Document upload']].map(([value,label]) => `<option value="${value}"${type === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label><label class="kyc-field kyc-field-full" data-kyc-options-wrap${type === 'select' ? '' : ' hidden'}><span>Dropdown options — one option per line</span><textarea rows="3" data-kyc-field-options maxlength="4000" placeholder="Employment\nSavings\nOther">${escape((Array.isArray(field.options) ? field.options : []).join('\n'))}</textarea><small>Use 1–30 unique choices, up to 120 characters each.</small></label></div><label class="kyc-builder-check"><input type="checkbox" data-kyc-field-required${field.required ? ' checked' : ''}> Required to submit</label></div>`;
  }
  function layerEditorMarkup(layer,index) {
    return `<article class="kyc-layer-editor" data-kyc-layer="${index}" data-layer-id="${escape(layer.id)}"><div class="kyc-layer-editor-heading"><span class="kyc-layer-number">${String(index + 1).padStart(2,'0')}</span><div><strong>${escape(layer.name || 'New verification layer')}</strong><small>Reusable verification layer</small></div><button type="button" class="kyc-text-button danger" data-kyc-remove-layer="${index}">Remove layer</button></div><div class="kyc-builder-grid"><label class="kyc-field"><span>Layer name</span><input type="text" data-kyc-layer-name value="${escape(layer.name)}" required minlength="2" maxlength="100" placeholder="For example: Source of funds"></label><label class="kyc-field"><span>Why this layer is needed (optional)</span><textarea data-kyc-layer-reason rows="2" maxlength="1500" placeholder="Explain what the user needs to provide and why.">${escape(layer.reason)}</textarea></label></div><div class="kyc-field-editors">${layer.fields.map((field,fieldIndex) => fieldEditorMarkup(field,fieldIndex,index)).join('')}</div><button type="button" class="admin-small-button" data-kyc-add-field="${index}"${layer.fields.length >= 12 ? ' disabled' : ''}>${icon('plus')} Add input field</button><small class="kyc-limit-label">${layer.fields.length} / 12 fields</small></article>`;
  }
  function renderSettings() {
    const container = $('#kyc-requirements-content');if (!container) return;
    if (state.settingsLoading) {container.innerHTML = '<div class="kyc-customer-loading" role="status"><span class="kyc-submit-spinner" aria-hidden="true"></span>Loading verification requirements…</div>';return;}
    if (!state.settings || !activeRequirements()) {container.innerHTML = '';return;}
    const settings = state.settings;
    container.innerHTML = `<form id="kyc-requirements-form" class="kyc-requirements-card" autocomplete="off"><div class="kyc-builder-heading"><div><span class="section-kicker">VERIFICATION / YOUR RULES</span><h3>Make every check clear<span>.</span></h3><p>Explain why you need verification, then build reusable layers of additional questions and documents.</p></div><span class="kyc-form-step">REVISION ${escape(settings.version)}</span></div><label class="kyc-field"><span>Why KYC is required</span><textarea name="reason" required minlength="10" rows="3" maxlength="3000" placeholder="Explain the purpose of identity verification to your users.">${escape(settings.reason)}</textarea><small>This explanation appears on every user’s verification page.</small></label><div class="kyc-builder-divider"><div><h4>Additional verification layers</h4><p>Keep questions relevant to the information you need. Assign any combination of saved layers to individual users below.</p></div><span>${settings.layers.length} / 8</span></div><div id="kyc-layer-editors">${settings.layers.length ? settings.layers.map(layerEditorMarkup).join('') : '<div class="kyc-builder-empty">No additional layers yet. The standard identity form remains available to every user.</div>'}</div><button class="button outline" type="button" data-kyc-add-layer${settings.layers.length >= 8 ? ' disabled' : ''}>Add verification layer ${icon('plus')}</button><p class="kyc-snapshot-note">Saving a template updates your library. Existing user assignments keep their saved questions. Reapply a user’s assignment to use the latest templates; the user must complete the updated checks before withdrawing.</p><div class="kyc-builder-save"><span>${icon('lock')} Changes apply only when saved.</span><button class="button green" type="submit" id="kyc-settings-save">Save requirements ${icon('check')}</button></div></form>`;
  }
  function readSettingsForm() {
    const form = $('#kyc-requirements-form');if (!form || !state.settings) return state.settings;
    return {version:state.settings.version,reason:$('[name="reason"]',form).value.trim(),layers:$$('[data-kyc-layer]',form).map(layer => ({id:layer.dataset.layerId,name:$('[data-kyc-layer-name]',layer).value.trim(),reason:$('[data-kyc-layer-reason]',layer).value.trim(),fields:$$('[data-kyc-field]',layer).map(field => ({key:field.dataset.fieldKey,label:$('[data-kyc-field-label]',field).value.trim(),type:$('[data-kyc-field-type]',field).value,required:$('[data-kyc-field-required]',field).checked,options:$('[data-kyc-field-type]',field).value === 'select' ? $('[data-kyc-field-options]',field).value.split('\n').map(value => value.trim()).filter(Boolean) : []}))}))};
  }
  function settingsValid(settings) {
    if (!settings || !safeKey(settings.layers?.[0]?.id || 'empty')) return false;
    const problem = settings.layers.find(layer => !layer.fields.length || layer.fields.some(field => field.type === 'select' && (field.options.length < 1 || field.options.length > 30 || field.options.some(option => option.length > 120) || new Set(field.options).size !== field.options.length)));
    if (problem) {message('#kyc-requirements-message','Each layer needs at least one input field. Dropdowns need 1–30 unique choices of up to 120 characters each.',true);return false;}
    return true;
  }
  async function loadSettings() {
    if (!activeRequirements()) return;
    const serial = ++settingsSerial;state.settingsLoading = true;message('#kyc-requirements-message','');renderSettings();
    try {
      const response = await request('/api/admin/kyc/requirements');
      if (serial !== settingsSerial || !activeRequirements()) return;
      if (!Number.isInteger(response?.settings?.version) || !Array.isArray(response.settings.layers)) throw new Error('Verification requirements could not be loaded. Refresh to try again.');
      state.settings = {version:response.settings.version,reason:String(response.settings.reason || ''),layers:layersOf(response.settings).map(layer => ({id:layer.id,name:String(layer.name || ''),reason:String(layer.reason || ''),fields:layer.fields.filter(field => safeKey(field.key)).map(field => ({key:field.key,label:String(field.label || ''),type:String(field.type || 'text'),required:field.required === true,options:Array.isArray(field.options) ? field.options.map(String) : []}))}))};state.savedLayers = JSON.parse(JSON.stringify(state.settings.layers));
    } catch (error) {if (serial === settingsSerial && activeRequirements()) message('#kyc-requirements-message',errorText(error),true);}
    finally {if (serial === settingsSerial) {state.settingsLoading = false;renderSettings();if (state.assignment) renderAssignment();}}
  }
  async function saveSettings(form) {
    if (!activeRequirements() || state.settingsSaving || !form.reportValidity()) return;
    const data = readSettingsForm();if (!settingsValid(data)) return;
    state.settings = data;state.settingsSaving = true;const serial = settingsSerial;
    const controls = $$('input,select,textarea,button',form);controls.forEach(control => control.disabled = true);form.setAttribute('aria-busy','true');
    $('#kyc-settings-save').innerHTML = '<span class="kyc-submit-spinner" aria-hidden="true"></span> Saving requirements…';message('#kyc-requirements-message','');
    try {
      const response = await request('/api/admin/kyc/requirements',{method:'PUT',body:JSON.stringify(data),headers:{'Content-Type':'application/json'}});
      if (serial !== settingsSerial || !activeRequirements()) return;
      if (!Number.isInteger(response?.settings?.version)) throw new Error('The saved requirements could not be confirmed. Refresh before trying again.');
      state.settings = {...data,version:response.settings.version};state.savedLayers = JSON.parse(JSON.stringify(data.layers));renderSettings();
      message('#kyc-requirements-message','Requirements saved. Existing user assignments are unchanged. Select a user below to apply the saved layers.');
      if (state.assignment) renderAssignment();
    } catch (error) {if (serial === settingsSerial && activeRequirements()) message('#kyc-requirements-message',`${errorText(error)} Use Refresh KYC to reload saved requirements if this form is out of date.`,true);}
    finally {if (serial === settingsSerial) state.settingsSaving = false;if (form.isConnected) {controls.forEach(control => control.disabled = false);form.setAttribute('aria-busy','false');$('#kyc-settings-save').innerHTML = `Save requirements ${icon('check')}`;}}
  }
  function editLayers(action,value) {
    if (!activeRequirements() || !state.settings || state.settingsSaving) return;
    state.settings = readSettingsForm();const layers = state.settings.layers;
    if (action === 'add-layer' && layers.length < 8) layers.push({id:newKey('layer'),name:'',reason:'',fields:[{key:newKey('field'),label:'',type:'text',required:true,options:[]}]});
    if (action === 'remove-layer') layers.splice(Number(value),1);
    if (action === 'add-field' && layers[Number(value)]?.fields.length < 12) layers[Number(value)].fields.push({key:newKey('field'),label:'',type:'text',required:true,options:[]});
    if (action === 'remove-field') {const [layerIndex,fieldIndex] = value.split(':').map(Number);layers[layerIndex]?.fields.splice(fieldIndex,1);}
    renderSettings();
    if (action === 'add-layer') $('[data-kyc-layer]:last-child [data-kyc-layer-name]')?.focus();
    if (action === 'add-field') $(`[data-kyc-layer="${Number(value)}"] [data-kyc-field]:last-child [data-kyc-field-label]`)?.focus();
  }
  function renderUsers() {
    const list = $('#kyc-users-list');if (!list) return;
    if (!activeRequirements()) {list.innerHTML = '';return;}
    if (state.usersLoading) {list.innerHTML = '<div class="kyc-customer-loading" role="status"><span class="kyc-submit-spinner" aria-hidden="true"></span>Finding accounts…</div>';return;}
    list.innerHTML = state.users.length ? state.users.map(user => `<article class="kyc-user-row"><div><strong>${escape(user.name)}</strong><span>${escape(user.email)}</span></div><div>${badge(user.kyc_status)}<small>${Array.isArray(user.layer_ids) ? user.layer_ids.length : 0} additional layers</small></div><button class="admin-small-button" type="button" data-kyc-select-user="${Number(user.id)}"${state.assignmentSaving ? ' disabled' : ''}>${Number(state.assignment?.user?.id) === Number(user.id) ? 'Selected account' : 'Set requirements'} ${icon('arrow')}</button></article>`).join('') : '<p class="kyc-builder-empty">No accounts match this search.</p>';
    const page = state.usersPagination;$('#kyc-users-pagination').hidden = Number(page.last_page) <= 1;$('#kyc-users-page-label').textContent = `Page ${page.current_page} of ${page.last_page} · ${page.total} accounts`;
    $('[data-kyc-users-page="previous"]').disabled = Number(page.current_page) <= 1;$('[data-kyc-users-page="next"]').disabled = Number(page.current_page) >= Number(page.last_page);
  }
  async function loadUsers(page = 1) {
    if (!activeRequirements()) return;
    const serial = ++usersSerial;state.usersLoading = true;message('#kyc-users-message','');renderUsers();
    const search = $('#kyc-user-search')?.value.trim() || '';
    try {
      const response = await request(`/api/admin/kyc/users?search=${encodeURIComponent(search)}&page=${Math.max(1,Number(page) || 1)}`);
      if (serial !== usersSerial || !activeRequirements()) return;
      state.users = Array.isArray(response?.users) ? response.users.filter(user => Number.isSafeInteger(Number(user.id)) && Number(user.id) > 0) : [];state.usersPagination = response?.pagination || {current_page:1,last_page:1,total:state.users.length};
    } catch (error) {if (serial === usersSerial && activeRequirements()) {state.users = [];message('#kyc-users-message',errorText(error),true);}}
    finally {if (serial === usersSerial) {state.usersLoading = false;renderUsers();}}
  }
  function renderAssignment() {
    const container = $('#kyc-user-assignment');if (!container) return;
    if (!activeRequirements()) {container.innerHTML = '';return;}
    if (state.assignmentLoading) {container.innerHTML = '<div class="kyc-customer-loading" role="status"><span class="kyc-submit-spinner" aria-hidden="true"></span>Loading this account’s requirements…</div>';return;}
    const data = state.assignment;if (!data) {container.innerHTML = '';return;}
    if (state.settingsLoading || !state.settings) {container.innerHTML = '<div class="kyc-customer-loading" role="status">Load the saved verification templates before editing this account. Use Refresh KYC to retry.</div>';return;}
    const current = data.requirements || {}, selected = Array.isArray(current.layer_ids) ? current.layer_ids : [], templates = state.savedLayers;
    const removed = selected.filter(id => !templates.some(layer => layer.id === id));
    container.innerHTML = `<form id="kyc-assignment-form" class="kyc-assignment-form" autocomplete="off"><div class="kyc-builder-heading"><div><span class="section-kicker">ACCOUNT #${Number(data.user.id)} / REQUIREMENT REVISION ${escape(current.version)}</span><h3>${escape(data.user.name)}</h3><p>${escape(data.user.email)}</p></div><button class="kyc-text-button" type="button" data-kyc-clear-user>Close account</button></div><fieldset class="kyc-layer-choices"><legend>Choose this user’s verification layers</legend>${templates.length ? templates.map(layer => `<label><input type="checkbox" name="layer_ids" value="${escape(layer.id)}"${selected.includes(layer.id) ? ' checked' : ''}><span><strong>${escape(layer.name || 'Untitled layer')}</strong><small>${layer.fields.length} input fields${layer.reason ? ` · ${escape(layer.reason)}` : ''}</small></span></label>`).join('') : '<p>Save a layer above to make additional checks available. This user will still complete the standard identity form.</p>'}</fieldset>${removed.length ? '<p class="kyc-snapshot-note">This account has saved layers that are no longer in the template library. Saving this assignment replaces them with the selected layers above.</p>' : ''}<label class="kyc-field"><span>Reason for this user’s KYC (optional)</span><textarea name="reason" rows="3" maxlength="3000" placeholder="Explain why this account needs these additional checks.">${escape(current.reason || '')}</textarea><small>This note appears only on this user’s verification page, alongside the general explanation.</small></label><p class="kyc-snapshot-note">Saving applies the current saved templates. If the requirements change, this user must submit a new identity check and receive approval before making new withdrawal requests. Existing submissions remain in the review history.</p><div id="kyc-assignment-message" class="kyc-message" role="status" hidden></div><div class="kyc-builder-save"><span>${selected.length} previously assigned layers</span><button class="button green" type="submit" id="kyc-assignment-save">Apply to this user ${icon('check')}</button></div></form>`;
  }
  async function loadAssignment(id) {
    if (!activeRequirements() || state.assignmentSaving) return;
    const userId = Number(id);if (!Number.isSafeInteger(userId) || userId < 1) return;
    const serial = ++assignmentSerial;state.assignment = null;state.assignmentLoading = true;renderAssignment();
    try {
      const response = await request(`/api/admin/kyc/users/${userId}/requirements`);
      if (serial !== assignmentSerial || !activeRequirements()) return;
      if (Number(response?.user?.id) !== userId || !Number.isInteger(response?.requirements?.version)) throw new Error('This account’s requirements could not be loaded. Select it again to retry.');
      state.assignment = {user:{id:userId,name:String(response.user.name || ''),email:String(response.user.email || '')},requirements:response.requirements};
    } catch (error) {if (serial === assignmentSerial && activeRequirements()) message('#kyc-users-message',errorText(error),true);}
    finally {if (serial === assignmentSerial) {state.assignmentLoading = false;renderAssignment();renderUsers();}}
  }
  async function saveAssignment(form) {
    if (!activeRequirements() || !state.assignment || state.assignmentSaving || state.settingsSaving || !form.reportValidity()) return;
    const userId = state.assignment.user.id, serial = assignmentSerial;
    const data = {version:state.assignment.requirements.version,layer_ids:$$('[name="layer_ids"]:checked',form).map(input => input.value),reason:$('[name="reason"]',form).value.trim()};
    state.assignmentSaving = true;const controls = $$('input,textarea,button',form);controls.forEach(control => control.disabled = true);form.setAttribute('aria-busy','true');$('#kyc-assignment-save').innerHTML = '<span class="kyc-submit-spinner" aria-hidden="true"></span> Applying checks…';message('#kyc-assignment-message','');renderUsers();
    try {
      const response = await request(`/api/admin/kyc/users/${userId}/requirements`,{method:'PUT',body:JSON.stringify(data),headers:{'Content-Type':'application/json'}});
      if (serial !== assignmentSerial || !activeRequirements()) return;
      if (!Number.isInteger(response?.requirements?.version)) throw new Error('The saved assignment could not be confirmed. Select this user again before retrying.');
      state.assignment = {...state.assignment,requirements:response.requirements};renderAssignment();message('#kyc-assignment-message','Verification requirements saved for this account. The user will see the assigned form and explanation.');
      if (Number(state.user.id) === Number(userId)) {state.summary = null;window.dispatchEvent(new CustomEvent('edge:kyc-updated',{detail:{requirementsChanged:true}}));}
      await loadUsers(state.usersPagination.current_page);
    } catch (error) {if (serial === assignmentSerial && activeRequirements()) message('#kyc-assignment-message',`${errorText(error)} Select this account again to reload its latest requirements.`,true);}
    finally {if (serial === assignmentSerial) state.assignmentSaving = false;if (form.isConnected) {controls.forEach(control => control.disabled = false);form.setAttribute('aria-busy','false');$('#kyc-assignment-save').innerHTML = `Apply to this user ${icon('check')}`;}renderUsers();}
  }
  function selectSection(section) {
    if (!['reviews','requirements'].includes(section)) return;
    if (state.section === 'requirements' && state.settings && !state.settingsLoading) state.settings = readSettingsForm();
    state.section = section;closeReview(false);
    $('#kyc-reviews-workspace').hidden = section !== 'reviews';$('#kyc-requirements-workspace').hidden = section !== 'requirements';
    $$('[data-kyc-section]').forEach(button => {if (button.dataset.kycSection === section) button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
    if (section === 'requirements') {if (!state.settings) loadSettings();else renderSettings();if (!state.users.length && !state.usersLoading) loadUsers();else renderUsers();renderAssignment();}
    else {settingsSerial++;usersSerial++;assignmentSerial++;state.settingsLoading = false;state.settingsSaving = false;state.usersLoading = false;state.assignmentLoading = false;state.assignmentSaving = false;state.assignment = null;$('#kyc-user-assignment').innerHTML = '';loadAdmin();}
  }
  function clearRequirements() {
    settingsSerial++;usersSerial++;assignmentSerial++;state.settings = null;state.savedLayers = [];state.settingsLoading = false;state.settingsSaving = false;state.users = [];state.usersLoading = false;state.assignment = null;state.assignmentLoading = false;state.assignmentSaving = false;state.usersPagination = {current_page:1,last_page:1,total:0};
    ['#kyc-requirements-content','#kyc-users-list','#kyc-user-assignment'].forEach(selector => {if ($(selector)) $(selector).innerHTML = '';});
    if ($('#kyc-user-search')) $('#kyc-user-search').value = '';if ($('#kyc-users-pagination')) $('#kyc-users-pagination').hidden = true;message('#kyc-requirements-message','');message('#kyc-users-message','');
    state.section = 'reviews';if ($('#kyc-reviews-workspace')) $('#kyc-reviews-workspace').hidden = false;if ($('#kyc-requirements-workspace')) $('#kyc-requirements-workspace').hidden = true;
    $$('[data-kyc-section]').forEach(button => {if (button.dataset.kycSection === 'reviews') button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
  }
  function clearAdmin() {adminSerial++;state.adminLoading = false;state.submissions = [];state.pagination = {current_page:1,last_page:1,total:0};closeReview(false);clearRequirements();if ($('#kyc-review-list')) $('#kyc-review-list').innerHTML = '';if ($('#kyc-review-pagination')) $('#kyc-review-pagination').hidden = true;message('#kyc-admin-message','');}
  function applySession(detail = {}) {
    const next = detail.user || null;
    const changed = state.user?.id !== next?.id || Boolean(state.user?.is_admin) !== Boolean(next?.is_admin) || state.serverMode !== (detail.serverMode === true);
    state.serverMode = detail.serverMode === true;state.user = next;
    if (changed) {
      customerSerial++;state.summary = null;state.customerLoading = false;state.customerError = '';state.submitting = false;clearAdmin();
      renderCustomer();
      if (activeCustomer() && signedIn()) loadCustomer();
      if (activeAdmin()) loadAdmin();
    }
    renderWalletNotice();
  }
  function selectAdminTab(tab) {
    const entering = tab === 'kyc';state.adminTab = entering;
    if (entering) loadAdmin();else clearAdmin();
  }
  function navigate(page) {
    if (page === 'verification') loadCustomer();
    else {customerSerial++;state.customerLoading = false;state.submitting = false;renderCustomer();}
    if (page !== 'admin') clearAdmin();else if (state.adminTab) loadAdmin();
  }
  function keydown(event) {
    if ($('#kyc-review-dialog')?.hidden) return;
    if (event.key === 'Escape') {event.preventDefault();closeReview();return;}
    if (event.key !== 'Tab') return;
    const elements = $$('a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex="0"]',$('#kyc-review-dialog')).filter(element => !element.closest('[hidden]'));
    const first = elements[0], last = elements.at(-1);
    if (event.shiftKey && document.activeElement === first) {event.preventDefault();last?.focus();}
    else if (!event.shiftKey && document.activeElement === last) {event.preventDefault();first?.focus();}
  }
  function click(event) {
    const button = event.target.closest('button');if (!button) return;
    if (button.hasAttribute('data-kyc-signin')) window.EdgeAPI?.openAuth?.('login');
    if (button.hasAttribute('data-kyc-open')) go('verification');
    if (button.hasAttribute('data-kyc-wallet')) go('wallet');
    if (button.hasAttribute('data-kyc-refresh')) loadCustomer();
    if (button.hasAttribute('data-kyc-resubmit') && signedIn() && state.summary?.status === 'rejected') {$('#kyc-customer-content').innerHTML = formMarkup();$('[name="legal_name"]',$('#kyc-submit-form'))?.focus();}
    if (button.hasAttribute('data-kyc-review')) openReview(button.dataset.kycReview,button);
    if (button.hasAttribute('data-kyc-close')) closeReview();
    if (button.id === 'kyc-review-refresh' || (button.id === 'admin-refresh' && state.adminTab)) {if (state.section === 'requirements') {loadSettings();loadUsers(state.usersPagination.current_page);if (state.assignment) loadAssignment(state.assignment.user.id);}else loadAdmin(state.pagination.current_page);}
    if (button.hasAttribute('data-kyc-page') && !state.adminLoading) loadAdmin(Number(state.pagination.current_page) + (button.dataset.kycPage === 'previous' ? -1 : 1));
    if (button.hasAttribute('data-kyc-back')) {state.decision = null;$('#kyc-review-confirmation').hidden = true;$('#kyc-review-confirmation').innerHTML = '';$('#kyc-review-form').hidden = false;$('#kyc-review-confirm-submit').focus();}
    if (button.id === 'kyc-decision-confirm') saveReview();
    if (button.hasAttribute('data-kyc-section')) selectSection(button.dataset.kycSection);
    if (button.hasAttribute('data-kyc-add-layer')) editLayers('add-layer');
    if (button.hasAttribute('data-kyc-remove-layer')) editLayers('remove-layer',button.dataset.kycRemoveLayer);
    if (button.hasAttribute('data-kyc-add-field')) editLayers('add-field',button.dataset.kycAddField);
    if (button.hasAttribute('data-kyc-remove-field')) editLayers('remove-field',button.dataset.kycRemoveField);
    if (button.hasAttribute('data-kyc-select-user')) loadAssignment(button.dataset.kycSelectUser);
    if (button.hasAttribute('data-kyc-clear-user') && !state.assignmentSaving) {assignmentSerial++;state.assignment = null;renderAssignment();renderUsers();}
    if (button.hasAttribute('data-kyc-users-page') && !state.usersLoading) loadUsers(Number(state.usersPagination.current_page) + (button.dataset.kycUsersPage === 'previous' ? -1 : 1));
  }
  function init() {
    if (initialized || !$('#verification-page')) return;initialized = true;
    const tabs = $('#admin-workspace .admin-tabs');const template = $('#kyc-admin-template');
    if (tabs && template) {
      const button = document.createElement('button');button.id = 'admin-tab-kyc';button.dataset.adminTab = 'kyc';button.setAttribute('role','tab');button.setAttribute('aria-controls','admin-kyc-tab');button.setAttribute('aria-selected','false');button.tabIndex = -1;button.textContent = 'Identity verification';tabs.append(button);
      $('#admin-workspace').insertBefore(template.content.cloneNode(true),$('#admin-workspace .admin-desk-footer'));
    }
    document.addEventListener('click',click);
    document.addEventListener('submit',event => {if (event.target.id === 'kyc-submit-form') {event.preventDefault();submitCustomer(event.target);}if (event.target.id === 'kyc-review-form') {event.preventDefault();confirmReview(event.target);}if (event.target.id === 'kyc-requirements-form') {event.preventDefault();saveSettings(event.target);}if (event.target.id === 'kyc-user-search-form') {event.preventDefault();loadUsers();}if (event.target.id === 'kyc-assignment-form') {event.preventDefault();saveAssignment(event.target);}});
    document.addEventListener('change',event => {
      if (event.target.matches('#kyc-submit-form input[type="file"]')) validateFile(event.target);
      if (event.target.id === 'kyc-review-status') {closeReview(false);loadAdmin();}
      if (event.target.hasAttribute('data-kyc-field-type')) $('[data-kyc-options-wrap]',event.target.closest('[data-kyc-field]')).hidden = event.target.value !== 'select';
      if (event.target.matches('#kyc-review-form [name="decision"]')) {const rejected = event.target.value === 'rejected';const note = $('#kyc-review-form [name="review_note"]');note.required = rejected;note.minLength = rejected ? 10 : 0;note.setCustomValidity('');$('#kyc-review-note-label').textContent = rejected ? 'Changes required (visible to the user)' : 'Review note (optional for approval)';}
    });
    document.addEventListener('input',event => {if (event.target.matches('#kyc-review-form [name="review_note"]')) event.target.setCustomValidity('');});
    document.addEventListener('keydown',keydown);
    $('#kyc-review-dialog')?.addEventListener('click',event => {if (event.target.id === 'kyc-review-dialog') closeReview();});
    window.addEventListener('edge:session',event => applySession(event.detail || {}));
    window.addEventListener('edge:account-state',event => {
      if (state.user?.id !== event.detail?.user?.id) return;
      const wasAdmin = isAdmin();
      const previousStatus = statusOf(state.user?.kyc_status || state.user?.kyc?.status);
      state.user = event.detail.user;
      if (wasAdmin && !isAdmin()) clearAdmin();
      const next = statusOf(state.user?.kyc_status || state.user?.kyc?.status);
      const changed = next !== previousStatus || Boolean(state.summary && state.summary.status !== next);
      if (changed) {
        state.summary = null;
        if (activeCustomer() && !state.submitting) {customerSerial++;state.customerLoading = false;loadCustomer();}
      }
      renderWalletNotice();
    });
    window.addEventListener('edge:navigate',event => navigate(event.detail?.page));
    window.addEventListener('edge:admin-tab',event => selectAdminTab(event.detail?.tab));
    applySession({serverMode:window.EdgeAPI?.serverMode === true,user:window.EdgeAPI?.user || null});
    if (!state.customerLoading) renderCustomer();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init);else init();
})();
