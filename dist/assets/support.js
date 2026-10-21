(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  const labels = {bot:'Automated support',waiting:'Waiting for admin',admin:'Admin connected',resolved:'Resolved'};
  const assistantLabel = 'Built-in account assistant';
  const quick = [['Balance','What is my available wallet balance?'],['Verification','What is my verification status?'],['Deposits','How can I deposit into my account?'],['Withdrawals','How can I withdraw from my account?'],['My stakes','What is the status of my stakes?'],['Copy staking','How are my copy staking positions doing?']];
  const state = {serverMode:false,user:null,open:false,conversation:null,loading:false,sending:false,handingOver:false,starting:false,pendingUser:null,userError:null,adminTab:false,adminLoading:false,conversations:[],pagination:{current_page:1,last_page:1,total:0},selected:null,pendingThreadID:null,detailLoading:false,adminBusy:false,pendingAdmin:null,historyUser:false,historyAdmin:false};
  const controllers = new Set();
  let initialized = false, epoch = 0, userRead = 0, inboxRead = 0, detailRead = 0, adminEpoch = 0, timer = null, lastFocus = null, lastAdminSignature = '';
  const signedIn = () => state.serverMode && Boolean(state.user?.id);
  const isAdmin = () => signedIn() && state.user.is_admin === true;
  const adminActive = () => isAdmin() && state.adminTab && !$('#admin-page')?.hidden;
  const visible = () => !document.hidden;
  const key = () => globalThis.crypto?.randomUUID?.() || `support-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const errorText = error => Object.values(error?.errors || {}).flat().join(' ') || error?.message || 'The connection could not be completed. Please try again.';
  const date = value => {const parsed = new Date(value);return value && !Number.isNaN(parsed.getTime()) ? new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(parsed) : '';};
  const aborted = error => error?.name === 'AbortError';
  const badge = status => `<span class="support-thread-badge ${escape(status)}">${escape(labels[status] || 'Support')}</span>`;
  function normalize(value) {
    if (!value || !Number.isInteger(Number(value.id)) || Number(value.id) < 1 || !Object.hasOwn(labels,value.status)) return null;
    return {...value,id:Number(value.id),version:Number(value.version) || 1,bot_answers:Math.max(0,Number(value.bot_answers) || 0),messages:(Array.isArray(value.messages) ? value.messages : []).filter(message => Number.isInteger(Number(message.id)) && ['user','assistant','admin','system'].includes(message.role)).map(message => ({...message,id:Number(message.id),body:String(message.body || ''),sender_name:String(message.sender_name || '')})),has_more:value.has_more === true};
  }
  async function request(path, options = {}) {
    if (!signedIn() || !window.EdgeAPI?.request) throw new Error('Sign in to use account support.');
    const controller = new AbortController();controllers.add(controller);
    try {return await window.EdgeAPI.request(path,{...options,signal:controller.signal});}
    finally {controllers.delete(controller);}
  }
  function setError(selector, text, retry = '') {
    const element = $(selector);if (!element) return;
    element.innerHTML = text ? `${escape(text)}${retry ? `<button type="button" data-support-retry="${escape(retry)}">Try again</button>` : ''}` : '';element.hidden = !text;
  }
  function acceptConversation(response, lane, history = false) {
    const incoming = normalize(response?.conversation);if (!incoming) return false;
    const property = lane === 'admin' ? 'selected' : 'conversation';const previous = state[property];
    if (previous?.id === incoming.id) {
      if (incoming.version < previous.version) return false;
      const messages = new Map(previous.messages.map(message => [message.id,message]));incoming.messages.forEach(message => messages.set(message.id,message));
      incoming.messages = [...messages.values()].sort((a,b) => a.id - b.id);
      if (!history && (lane === 'admin' ? state.historyAdmin : state.historyUser)) incoming.has_more = previous.has_more;
    } else if (lane === 'admin') state.historyAdmin = false;else state.historyUser = false;
    state[property] = incoming;return true;
  }
  function transcript(root, conversation, customer = false) {
    if (!root) return;
    const messages = conversation?.messages || [];
    const welcome = !conversation && customer ? [{id:'welcome',role:'assistant',body:'Hi, welcome to EDGE support. I can help with your wallet, verification, deposits, withdrawals, stakes and copy staking. After a few questions, I’ll connect you to an administrator. How can I help?',sender_name:assistantLabel,created_at:null}] : [];
    const items = messages.length ? messages : welcome;
    const oldScroller = customer ? $('#support-chat-body') : root;
    const oldHeight = oldScroller.scrollHeight, oldTop = oldScroller.scrollTop;
    const nearBottom = oldScroller.scrollHeight - oldScroller.scrollTop - oldScroller.clientHeight < 90;
    const known = new Map([...root.children].map(node => [node.dataset.messageId,node]));const keep = new Set();
    const prepending = known.size > 0 && Number(items[0]?.id) < Number(root.firstElementChild?.dataset.messageId);
    items.forEach((message,index) => {
      const id = String(message.id);keep.add(id);let node = known.get(id);
      if (!node) {node = document.createElement('article');node.dataset.messageId = id;node.className = `support-message ${message.role}`;root.append(node);}
      const sender = message.role === 'user' ? (customer ? 'You' : conversation?.user?.name || 'User') : message.role === 'admin' ? message.sender_name || 'Administrator' : message.role === 'system' ? 'EDGE' : assistantLabel;
      const markup = `<div class="support-message-meta"><strong>${escape(sender)}</strong><time>${escape(date(message.created_at))}</time></div><p>${escape(message.body)}</p>`;
      if (node.innerHTML !== markup) node.innerHTML = markup;
      if (root.children[index] !== node) root.insertBefore(node,root.children[index] || null);
    });
    [...root.children].forEach(node => {if (!keep.has(node.dataset.messageId)) node.remove();});
    if (prepending) oldScroller.scrollTop = oldTop + oldScroller.scrollHeight - oldHeight;
    else if (nearBottom) oldScroller.scrollTop = oldScroller.scrollHeight;
  }
  function userBusy() {return state.sending || state.handingOver || state.starting;}
  function renderCustomer() {
    if (!$('#support-panel')) return;
    const guest = !signedIn(), status = state.conversation?.status || 'bot';
    $('#support-guest').hidden = !guest;$('#support-customer-thread').hidden = guest;$('#support-footer').hidden = guest;
    if (guest) {
      $('#support-guest').innerHTML = `<span aria-hidden="true">✳</span><h3>A little help. A human touch.</h3><p>${state.serverMode ? 'Sign in for private answers about your account and a conversation with the support team.' : 'This is a read-only preview. Open the Laravel app and sign in to use account support.'}</p>${state.serverMode ? '<button class="button green" data-support-signin>Sign in ↗</button>' : '<span class="demo-badge">READ-ONLY PREVIEW</span>'}`;
      $('#support-messages').replaceChildren();$('#support-error').hidden = true;$('#support-status').textContent = 'Sign in for account support';$('#support-question-count').textContent = '';$('#support-assistant-label').textContent = assistantLabel;return;
    }
    $('#support-status').textContent = state.loading && !state.conversation ? 'Connecting…' : labels[status];
    $('#support-question-count').textContent = status === 'bot' ? `${Math.min(3,state.conversation?.bot_answers || 0)} / 3 questions` : '';
    $('#support-assistant-label').textContent = status === 'admin' ? `Connected with ${state.conversation?.assigned_admin?.name || 'an administrator'}` : status === 'waiting' ? 'The support team will reply here' : status === 'resolved' ? 'This conversation is complete' : assistantLabel;
    $('#support-handover').hidden = status !== 'bot';$('#support-handover').disabled = userBusy() || state.loading;
    $('#support-handover').textContent = state.handingOver ? 'Joining the queue…' : 'Talk to admin ↗';
    $('#support-chat-form').hidden = status === 'resolved';$('#support-new').hidden = status !== 'resolved';$('#support-new').disabled = userBusy() || state.loading;
    $('#support-input').disabled = userBusy() || state.loading;$('#support-send').disabled = userBusy() || state.loading;
    $('#support-input').placeholder = status === 'waiting' ? 'Add a message for the support team…' : status === 'admin' ? 'Reply to your administrator…' : 'Ask about your account…';
    $('#support-send').setAttribute('aria-busy',String(state.sending));$('#support-chat-form').setAttribute('aria-busy',String(state.sending));$('#support-thinking').hidden = !state.sending || status !== 'bot';
    $('#support-load-older').hidden = !state.conversation?.has_more;$('#support-load-older').disabled = state.loading;
    const questions = $('#support-quick');questions.hidden = status !== 'bot';
    if (!questions.children.length) questions.innerHTML = quick.map(([label,question],index) => `<button type="button" data-support-question="${index}">${escape(label)} ↗</button>`).join('');
    $$('button',questions).forEach(button => button.disabled = userBusy() || state.loading);
    transcript($('#support-messages'),state.conversation,true);
    setError('#support-error',state.userError?.text || '',state.userError?.retry || '');
  }
  async function loadCustomer(silent = false, older = false) {
    if (!signedIn() || (!state.open && !older) || state.loading || userBusy()) return;
    const accountEpoch = epoch, serial = ++userRead;state.loading = !silent || older;if (!silent) renderCustomer();
    try {
      const path = older && state.conversation ? `/api/support/conversations/${state.conversation.id}?before_id=${state.conversation.messages[0]?.id || ''}` : '/api/support';
      const response = await request(path);
      if (accountEpoch !== epoch || serial !== userRead || !signedIn()) return;
      if (response?.conversation) {if (acceptConversation(response,'user',older) && older) state.historyUser = true;}
      if (state.userError?.retry === 'load') state.userError = null;
    } catch (error) {if (accountEpoch === epoch && serial === userRead && !aborted(error)) state.userError = {text:errorText(error),retry:'load'};}
    finally {if (accountEpoch === epoch && serial === userRead) {state.loading = false;renderCustomer();}}
  }
  async function ensureConversation() {
    if (state.conversation && state.conversation.status !== 'resolved') return state.conversation;
    const response = await request('/api/support/conversations',{method:'POST',body:{}});
    return response;
  }
  async function sendCustomer() {
    if (!signedIn() || userBusy() || state.loading || state.conversation?.status === 'resolved') return;
    const input = $('#support-input'), body = input.value.trim();if (!body || body.length > 2000) {input.reportValidity();return;}
    userRead++;
    const accountEpoch = epoch;state.sending = true;state.userError = null;
    if (state.pendingUser?.body !== body) state.pendingUser = {body,idempotency_key:key()};
    const pending = {...state.pendingUser};renderCustomer();
    try {
      if (!state.conversation) {const response = await ensureConversation();if (accountEpoch !== epoch) return;if (!acceptConversation(response,'user')) throw new Error('Your support conversation could not be started.');}
      const response = await request(`/api/support/conversations/${state.conversation.id}/messages`,{method:'POST',body:pending});
      if (accountEpoch !== epoch) return;
      if (!acceptConversation(response,'user')) throw new Error('Your message status could not be confirmed. Try again with the same message.');
      state.pendingUser = null;input.value = '';state.userError = null;
    } catch (error) {if (accountEpoch === epoch && !aborted(error)) state.userError = {text:errorText(error),retry:'send'};}
    finally {if (accountEpoch === epoch) {state.sending = false;renderCustomer();if (state.open) input.focus();}}
  }
  async function handover() {
    if (!signedIn() || userBusy() || state.loading || ['waiting','admin','resolved'].includes(state.conversation?.status)) return;
    userRead++;
    const accountEpoch = epoch;state.handingOver = true;state.userError = null;renderCustomer();
    try {
      if (!state.conversation) {const response = await ensureConversation();if (accountEpoch !== epoch) return;if (!acceptConversation(response,'user')) throw new Error('Your support conversation could not be started.');}
      const response = await request(`/api/support/conversations/${state.conversation.id}/handover`,{method:'POST',body:{}});
      if (accountEpoch !== epoch) return;
      if (!acceptConversation(response,'user')) throw new Error('Your handover status could not be confirmed.');
    } catch (error) {if (accountEpoch === epoch && !aborted(error)) state.userError = {text:errorText(error),retry:'handover'};}
    finally {if (accountEpoch === epoch) {state.handingOver = false;renderCustomer();}}
  }
  async function startNew() {
    if (!signedIn() || userBusy() || state.loading || state.conversation?.status !== 'resolved') return;
    userRead++;
    const accountEpoch = epoch;state.starting = true;state.userError = null;renderCustomer();
    try {const response = await ensureConversation();if (accountEpoch !== epoch) return;if (!acceptConversation(response,'user')) throw new Error('A new support conversation could not be started.');state.pendingUser = null;$('#support-input').value = '';}
    catch (error) {if (accountEpoch === epoch && !aborted(error)) state.userError = {text:errorText(error),retry:'new'};}
    finally {if (accountEpoch === epoch) {state.starting = false;renderCustomer();if (state.open) $('#support-input').focus();}}
  }
  function open() {
    if (!initialized) return;if (state.open) {$('#support-close').focus();return;}lastFocus = document.activeElement;state.open = true;$('#support-panel').hidden = false;$('#support-launcher').setAttribute('aria-expanded','true');renderCustomer();$('#support-close').focus();loadCustomer();schedulePoll();
  }
  function close() {
    state.open = false;$('#support-panel').hidden = true;$('#support-launcher').setAttribute('aria-expanded','false');schedulePoll();
    if (lastFocus?.isConnected) lastFocus.focus();else $('#support-launcher').focus();
  }
  function renderInbox() {
    const root = $('#support-inbox-list');if (!root) return;
    if (!isAdmin()) {root.replaceChildren();return;}
    const signature = JSON.stringify([state.conversations,state.pagination,state.selected?.id,state.adminLoading]);
    if (signature === lastAdminSignature) return;lastAdminSignature = signature;
    const focusID = root.contains(document.activeElement) ? document.activeElement?.dataset.supportThread : null;
    root.innerHTML = state.adminLoading && !state.conversations.length ? '<div class="support-inbox-loading" role="status">Loading conversations…</div>' : state.conversations.length ? state.conversations.map(conversation => `<button class="support-inbox-row${state.selected?.id === conversation.id ? ' selected' : ''}" data-support-thread="${conversation.id}" aria-pressed="${state.selected?.id === conversation.id}"><strong>${escape(conversation.user?.name || 'User')}</strong><span>${escape(conversation.user?.email || '')}</span><small>${badge(conversation.status)}<time>${escape(date(conversation.last_message_at || conversation.created_at))}</time></small></button>`).join('') : '<p class="support-inbox-list-empty">No conversations in this queue.</p>';
    if (focusID) $$('[data-support-thread]',root).find(button => button.dataset.supportThread === focusID)?.focus();
    const pagination = state.pagination;$('#support-inbox-count').textContent = `${Number(pagination.total) || 0} conversation${Number(pagination.total) === 1 ? '' : 's'}`;
    $('#support-inbox-pagination').hidden = pagination.last_page <= 1;$('#support-inbox-page').textContent = `${pagination.current_page} / ${pagination.last_page}`;
    $('[data-support-page="previous"]').disabled = state.adminLoading || pagination.current_page <= 1;$('[data-support-page="next"]').disabled = state.adminLoading || pagination.current_page >= pagination.last_page;
  }
  async function loadInbox(page = state.pagination.current_page, silent = false) {
    if (!adminActive() || state.adminLoading) return;
    const accountEpoch = epoch, viewEpoch = adminEpoch, serial = ++inboxRead;state.adminLoading = !silent;if (!silent) renderInbox();
    try {
      const response = await request(`/api/admin/support?status=${encodeURIComponent($('#support-inbox-filter').value)}&page=${Math.max(1,Number(page) || 1)}`);
      if (accountEpoch !== epoch || viewEpoch !== adminEpoch || serial !== inboxRead || !adminActive()) return;
      const values = response.conversations || response.threads || [];state.conversations = (Array.isArray(values) ? values : []).map(normalize).filter(Boolean);
      state.pagination = {current_page:Number(response.pagination?.current_page) || 1,last_page:Number(response.pagination?.last_page) || 1,total:Number(response.pagination?.total) || 0};
      if (!state.adminBusy && $('#support-admin-error').dataset.source === 'inbox') setError('#support-admin-error','');
    } catch (error) {if (accountEpoch === epoch && viewEpoch === adminEpoch && serial === inboxRead && !aborted(error)) {setError('#support-admin-error',errorText(error),'inbox');$('#support-admin-error').dataset.source = 'inbox';}}
    finally {if (accountEpoch === epoch && viewEpoch === adminEpoch && serial === inboxRead) {state.adminLoading = false;renderInbox();}}
  }
  function ownThread(conversation = state.selected) {return conversation?.assigned_admin && Number(conversation.assigned_admin.id) === Number(state.user?.id);}
  function canReply() {return adminActive() && state.selected?.status === 'admin' && ownThread() && !state.adminBusy;}
  function renderAdminThread() {
    const root = $('#support-admin-thread');if (!root || !isAdmin()) return;
    const selected = state.selected;
    if (!selected) {root.dataset.threadId = '';root.innerHTML = state.detailLoading ? '<div class="support-inbox-loading" role="status">Opening conversation…</div>' : '<div class="support-inbox-empty"><span aria-hidden="true">↗</span><h3>Make the next connection.</h3><p>Choose a conversation to read the account assistant’s messages and help the user.</p></div>';return;}
    const fresh = root.dataset.threadId !== String(selected.id);
    if (fresh) {
      root.dataset.threadId = selected.id;
      root.innerHTML = '<header class="support-admin-thread-heading"><div><h3 id="support-admin-customer"></h3><p id="support-admin-customer-meta"></p></div><div class="support-admin-thread-actions" id="support-admin-actions"></div></header><div class="support-connection-note" id="support-admin-connection" hidden></div><button class="support-older" id="support-admin-load-older" hidden>Load earlier messages ↑</button><div class="support-messages" id="support-admin-messages" role="log" aria-label="Selected conversation messages" aria-live="polite" aria-relevant="additions text"></div><p class="support-admin-assigned" id="support-admin-assigned" hidden></p><form class="support-admin-composer" id="support-admin-form"><label for="support-admin-input">Your reply to the user</label><textarea id="support-admin-input" name="body" rows="3" maxlength="2000" placeholder="Write a helpful reply…" required></textarea><div><small>Sent as an administrator.<br>Visible only to this user and the support team.</small><button type="submit" class="button green" id="support-admin-send">Send reply ↗</button></div><div class="support-error" id="support-admin-reply-error" role="alert" hidden></div></form>';
    }
    $('#support-admin-customer').textContent = selected.user?.name || 'User';$('#support-admin-customer-meta').textContent = `${selected.user?.email || ''} · Conversation #${selected.id}`;
    const selfCustomer = Number(selected.user?.id) === Number(state.user?.id), claimable = ['waiting','bot'].includes(selected.status) && !selfCustomer;
    const actions = $('#support-admin-actions');const actionMarkup = `${badge(selected.status)}${claimable ? `<button type="button" class="button green" data-support-action="claim"${state.adminBusy ? ' disabled' : ''}>${state.adminBusy ? 'Please wait…' : 'Claim conversation ↗'}</button>` : ''}${selected.status === 'admin' && ownThread() ? `<button type="button" class="button outline" data-support-action="resolve"${state.adminBusy ? ' disabled' : ''}>${state.adminBusy ? 'Please wait…' : 'Mark resolved ✓'}</button>` : ''}`;
    if (actions.innerHTML !== actionMarkup) actions.innerHTML = actionMarkup;
    const info = $('#support-admin-assigned');info.hidden = selected.status === 'admin' && ownThread();
    info.textContent = selfCustomer ? 'Another administrator must manage your own support conversation.' : selected.status === 'resolved' ? 'This conversation is resolved. Its history remains available here.' : selected.status === 'admin' ? `Assigned to ${selected.assigned_admin?.name || 'another administrator'}. Only that administrator can reply or resolve it.` : 'Claim this conversation to pause the account assistant and reply as an administrator.';
    $('#support-admin-form').hidden = selected.status !== 'admin' || !ownThread();$('#support-admin-input').disabled = !canReply();$('#support-admin-send').disabled = !canReply();$('#support-admin-send').textContent = state.adminBusy ? 'Sending…' : 'Send reply ↗';$('#support-admin-form').setAttribute('aria-busy',String(state.adminBusy));
    $('#support-admin-load-older').hidden = !selected.has_more;$('#support-admin-load-older').disabled = state.detailLoading;
    transcript($('#support-admin-messages'),selected);
  }
  async function loadThread(id, silent = false, older = false) {
    if (!adminActive() || state.adminBusy || (state.detailLoading && silent)) return;
    const accountEpoch = epoch, viewEpoch = adminEpoch, serial = ++detailRead;const threadID = Number(id);if (!Number.isInteger(threadID) || threadID < 1) return;
    state.pendingThreadID = threadID;
    const changed = state.selected?.id !== threadID;
    if (changed) {state.selected = null;state.pendingAdmin = null;state.historyAdmin = false;}
    state.detailLoading = !silent || older;if (!silent) renderAdminThread();
    try {
      const query = older ? `?before_id=${state.selected?.messages[0]?.id || ''}` : '';
      const response = await request(`/api/admin/support/${threadID}${query}`);
      if (accountEpoch !== epoch || viewEpoch !== adminEpoch || serial !== detailRead || !adminActive()) return;
      if (!acceptConversation(response,'admin',older)) throw new Error('This support conversation could not be opened.');
      if (older) state.historyAdmin = true;
      if ($('#support-admin-error').dataset.source !== 'inbox') setError('#support-admin-error','');
      const connection = $('#support-admin-connection');if (connection) connection.hidden = true;
    } catch (error) {if (accountEpoch === epoch && viewEpoch === adminEpoch && serial === detailRead && !aborted(error)) {if (silent && $('#support-admin-connection')) {$('#support-admin-connection').textContent = 'Updates are paused. Refresh the conversation to reconnect.';$('#support-admin-connection').hidden = false;}else {setError('#support-admin-error',errorText(error),'thread');$('#support-admin-error').dataset.source = 'thread';}}}
    finally {if (accountEpoch === epoch && viewEpoch === adminEpoch && serial === detailRead) {state.detailLoading = false;renderAdminThread();renderInbox();}}
  }
  async function adminAction(action) {
    if (!adminActive() || state.adminBusy || !state.selected || !['claim','reply','resolve'].includes(action)) return;
    if (action === 'reply' && !canReply()) return;
    const selectedID = state.selected.id, accountEpoch = epoch, viewEpoch = adminEpoch, body = $('#support-admin-input')?.value.trim() || '';
    if (action === 'reply' && (!body || body.length > 2000)) {$('#support-admin-input').reportValidity();return;}
    if (action === 'reply' && state.pendingAdmin?.body !== body) state.pendingAdmin = {body,idempotency_key:key()};
    const payload = {version:state.selected.version,...(action === 'reply' ? state.pendingAdmin : {})};state.adminBusy = true;setError('#support-admin-error','');setError('#support-admin-reply-error','');renderAdminThread();
    try {
      const response = await request(`/api/admin/support/${selectedID}/${action}`,{method:'POST',body:payload});
      if (accountEpoch !== epoch || viewEpoch !== adminEpoch || state.selected?.id !== selectedID || !adminActive()) return;
      if (!acceptConversation(response,'admin')) throw new Error('The conversation status could not be confirmed. Refresh before continuing.');
      if (action === 'reply') {$('#support-admin-input').value = '';state.pendingAdmin = null;}
      if (state.conversation?.id === selectedID) {acceptConversation(response,'user');renderCustomer();}
    } catch (error) {if (accountEpoch === epoch && viewEpoch === adminEpoch && !aborted(error)) {setError(action === 'reply' ? '#support-admin-reply-error' : '#support-admin-error',errorText(error),action === 'reply' ? 'reply' : 'thread');if (Number(error?.status) === 409) {state.adminBusy = false;await loadThread(selectedID,true);}}}
    finally {if (accountEpoch === epoch && viewEpoch === adminEpoch) {state.adminBusy = false;renderAdminThread();loadInbox(state.pagination.current_page,true);}}
  }
  function clearAdmin() {
    adminEpoch++;inboxRead++;detailRead++;state.adminLoading = false;state.detailLoading = false;state.adminBusy = false;state.selected = null;state.pendingThreadID = null;state.pendingAdmin = null;state.conversations = [];state.pagination = {current_page:1,last_page:1,total:0};state.historyAdmin = false;lastAdminSignature = '';
    $('#support-inbox-list')?.replaceChildren();$('#support-admin-thread')?.replaceChildren();if ($('#support-admin-thread')) $('#support-admin-thread').dataset.threadId = '';$('#support-inbox-pagination')?.setAttribute('hidden','');if ($('#support-inbox-count')) $('#support-inbox-count').textContent = '';setError('#support-admin-error','');
  }
  function resetPrivate() {
    epoch++;userRead++;controllers.forEach(controller => controller.abort());controllers.clear();clearAdmin();
    state.conversation = null;state.loading = false;state.sending = false;state.handingOver = false;state.starting = false;state.pendingUser = null;state.userError = null;state.historyUser = false;
    $('#support-messages')?.replaceChildren();if ($('#support-input')) $('#support-input').value = '';$('#support-guest')?.replaceChildren();setError('#support-error','');
  }
  function applySession(detail = {}) {
    const nextUser = detail.user || null, nextMode = detail.serverMode === true;
    const changed = state.user?.id !== nextUser?.id || state.serverMode !== nextMode || Boolean(state.user?.is_admin) !== Boolean(nextUser?.is_admin);
    if (changed) resetPrivate();state.serverMode = nextMode;state.user = nextUser;renderCustomer();
    if (state.open && signedIn() && changed) loadCustomer();if (adminActive() && changed) {renderAdminThread();loadInbox(1);}schedulePoll();
  }
  function schedulePoll() {
    clearTimeout(timer);timer = null;
    if (!visible() || (!state.open && !adminActive()) || !signedIn()) return;
    timer = setTimeout(async () => {timer = null;if (!visible()) return;const jobs = [];if (state.open) jobs.push(loadCustomer(true));if (adminActive()) {jobs.push(loadInbox(state.pagination.current_page,true));if (state.selected) jobs.push(loadThread(state.selected.id,true));}await Promise.allSettled(jobs);schedulePoll();},6000);
  }
  function adminTab(tab) {
    state.adminTab = tab === 'support';
    if (!state.adminTab) clearAdmin();else if (adminActive()) {renderAdminThread();loadInbox(1);}schedulePoll();
  }
  function init() {
    if (initialized || !$('#support-widget')) return;initialized = true;
    const tabs = $('#admin-workspace .admin-tabs'), template = $('#support-admin-template');
    if (tabs && template) {const button = document.createElement('button');button.id = 'admin-tab-support';button.dataset.adminTab = 'support';button.setAttribute('role','tab');button.setAttribute('aria-controls','admin-support-tab');button.setAttribute('aria-selected','false');button.tabIndex = -1;button.textContent = 'Support inbox';tabs.append(button);$('#admin-workspace').insertBefore(template.content.cloneNode(true),$('#admin-workspace .admin-desk-footer'));}
    window.EdgeSupport = {open,close};
    document.addEventListener('click',event => {
      const button = event.target.closest('button');if (!button || button.disabled) return;
      if (button.id === 'support-launcher') {if (state.open) close();else open();}
      if (button.hasAttribute('data-support-open')) open();
      if (button.id === 'support-close') close();
      if (button.hasAttribute('data-support-signin')) {close();window.EdgeAPI?.openAuth?.('login');}
      if (button.hasAttribute('data-support-question')) {const question = quick[Number(button.dataset.supportQuestion)];if (question && signedIn() && !userBusy()) {$('#support-input').value = question[1];sendCustomer();}}
      if (button.id === 'support-handover') handover();if (button.id === 'support-new') startNew();
      if (button.id === 'support-load-older') loadCustomer(false,true);
      if (button.id === 'support-admin-load-older' && state.selected) loadThread(state.selected.id,false,true);
      if (button.hasAttribute('data-support-thread')) loadThread(button.dataset.supportThread);
      if (button.hasAttribute('data-support-action')) adminAction(button.dataset.supportAction);
      if (button.id === 'support-inbox-refresh' || (button.id === 'admin-refresh' && adminActive())) {loadInbox();if (state.selected) loadThread(state.selected.id);}
      if (button.hasAttribute('data-support-page')) loadInbox(state.pagination.current_page + (button.dataset.supportPage === 'previous' ? -1 : 1));
      if (button.hasAttribute('data-support-retry')) {const retry = button.dataset.supportRetry;if (retry === 'load') loadCustomer();if (retry === 'send') sendCustomer();if (retry === 'handover') handover();if (retry === 'new') startNew();if (retry === 'inbox') loadInbox();if (retry === 'thread' && (state.selected || state.pendingThreadID)) loadThread(state.selected?.id || state.pendingThreadID);if (retry === 'reply') adminAction('reply');}
    });
    document.addEventListener('submit',event => {if (event.target.id === 'support-chat-form') {event.preventDefault();sendCustomer();}if (event.target.id === 'support-admin-form') {event.preventDefault();adminAction('reply');}});
    document.addEventListener('change',event => {if (event.target.id === 'support-inbox-filter') {inboxRead++;state.adminLoading = false;state.conversations = [];state.pagination.current_page = 1;loadInbox(1);}});
    document.addEventListener('keydown',event => {if (event.key === 'Escape' && state.open && $('#support-panel').contains(document.activeElement)) {event.preventDefault();close();}});
    document.addEventListener('visibilitychange',() => {if (visible()) {if (state.open) loadCustomer(true);if (adminActive()) {loadInbox(state.pagination.current_page,true);if (state.selected) loadThread(state.selected.id,true);}}schedulePoll();});
    window.addEventListener('edge:session',event => applySession(event.detail || {}));
    window.addEventListener('edge:account-state',event => {const next = event.detail?.user || null;if (state.user?.id !== next?.id || Boolean(state.user?.is_admin) !== Boolean(next?.is_admin)) applySession({serverMode:state.serverMode,user:next});else state.user = next;});
    window.addEventListener('edge:admin-tab',event => adminTab(event.detail?.tab));
    window.addEventListener('edge:navigate',event => {if (event.detail?.page !== 'admin') {state.adminTab = false;clearAdmin();}else if (state.adminTab && adminActive()) loadInbox(1);schedulePoll();});
    applySession({serverMode:window.EdgeAPI?.serverMode === true,user:window.EdgeAPI?.user || null});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init);else init();
})();
