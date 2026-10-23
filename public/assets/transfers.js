(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = value => new Intl.NumberFormat('en-US', {style:'currency',currency:'USD'}).format(value / 100);
  const api = () => window.EdgeAPI;
  const active = () => !$('#wallet-page')?.hidden;
  let identity = null, epoch = 0, serial = 0, loading = false, pending = false, page = 1, lastLoaded = 0, intent = null, focusBefore;
  const panel = document.createElement('section');panel.id = 'wallet-transfers';panel.className = 'internal-transfers';
  $('#wallet-page')?.insertBefore(panel, $('.transaction-heading'));
  const modal = document.createElement('div');modal.className = 'modal-backdrop';modal.id = 'transfer-modal';modal.hidden = true;
  modal.innerHTML = '<section class="modal info-modal transfer-dialog" role="dialog" aria-modal="true" aria-labelledby="transfer-title"><button class="icon-button modal-close" type="button" data-transfer-close aria-label="Close transfer">×</button><div id="transfer-content"></div></section>';
  document.body.append(modal);
  function shell() {
    if (!api()?.serverMode) {panel.innerHTML = '<h2>EDGE transfers</h2><p>Internal account numbers and transfers are available in the live Laravel app.</p>';return;}
    const user = api().user;
    if (!user) {panel.innerHTML = '<h2>EDGE transfers</h2><p>Sign in to see your account number and send funds to another EDGE user.</p><button class="button green" data-transfer-signin>Sign in ↗</button>';return;}
    panel.innerHTML = `<div class="transfer-panel-top"><div><span class="section-kicker">YOUR EDGE ACCOUNT NUMBER</span><div class="transfer-account"><strong id="internal-account-number">${esc(user.account_number || 'Loading…')}</strong><button type="button" class="button outline" data-transfer-copy ${user.account_number?'':'disabled'}>Copy</button></div><p>Share this number to receive USD from another EDGE user. This is an internal account, not a bank account.</p></div><button type="button" class="button green" data-transfer-open>Send money ↗</button></div><div class="transfer-history-heading"><h3>Transfers</h3><button class="auth-switch" type="button" data-transfer-refresh>Refresh history ↻</button></div><p id="transfer-panel-status" role="status" hidden></p><div id="transfer-history"></div><div class="transfer-pagination" id="transfer-pagination" hidden><button class="button outline" data-transfer-page="previous">Previous</button><span id="transfer-page-label"></span><button class="button outline" data-transfer-page="next">Next</button></div>`;
  }
  async function history(nextPage = page) {
    if (!api()?.user || !active() || loading) return;
    const seq = ++serial, accountEpoch = epoch;loading = true;
    const status = $('#transfer-panel-status');if (status) {status.hidden=false;status.textContent='Loading transfers…';}
    try {
      const data = await api().request('/api/wallet/transfers?page=' + nextPage);
      if (accountEpoch !== epoch || seq !== serial || !api()?.user) return;
      page = data.pagination.current_page;lastLoaded = Date.now();
      $('#internal-account-number').textContent = data.account_number;
      $('[data-transfer-copy]').disabled = !data.account_number;
      $('#transfer-history').innerHTML = data.transfers.length ? data.transfers.map(t => `<article class="transfer-history-row"><div><strong>${t.direction==='sent'?'To':'From'} ${esc(t.counterparty.name)}</strong><span>EDGE ${esc(t.counterparty.account_number)} · ${esc(new Date(t.created_at).toLocaleString())}</span><small>${esc(t.reference)}</small></div><div><strong class="${t.direction==='sent'?'amount-negative':'amount-positive'}">${t.direction==='sent'?'−':'+'}${money(t.amount_cents)}</strong><span>Completed</span></div></article>`).join('') : '<p class="transfer-empty">Sent and received transfers appear here. Funds move directly between EDGE wallets.</p>';
      $('#transfer-pagination').hidden = data.pagination.last_page <= 1;
      $('#transfer-page-label').textContent = `Page ${page} of ${data.pagination.last_page}`;
      $('[data-transfer-page="previous"]').disabled = page<=1;
      $('[data-transfer-page="next"]').disabled = page>=data.pagination.last_page;
      status.hidden=true;
    } catch (error) {if(accountEpoch===epoch && status?.isConnected){status.hidden=false;status.textContent=error.message || 'Could not load transfers. Refresh to try again.';}}
    finally {if(accountEpoch===epoch)loading=false;}
  }
  function close(force = false) {
    if (pending && !force) return;
    modal.hidden=true;modal.removeAttribute('aria-busy');document.body.style.overflow='';
    const password = $('#transfer-password');if(password)password.value='';
    if(focusBefore?.isConnected)focusBefore.focus();
  }
  function view(title, body) {
    $('#transfer-content').innerHTML = `<span class="section-kicker">YOUR WALLET. YOUR NEXT MOVE.</span><h2 id="transfer-title">${title}<span>.</span></h2>${body}`;
    modal.hidden=false;document.body.style.overflow='hidden';$('input,button', $('#transfer-content'))?.focus();
  }
  function open() {
    if (!api()?.user) {api()?.openAuth();return;}
    if (pending) return;
    focusBefore=document.activeElement;
    if (intent) {review();return;}
    if (api().user.kyc_status !== 'approved') {view('VERIFY BEFORE SENDING','<p>Administrator-approved identity verification is required to send funds to another account.</p><button class="button green" data-transfer-verify>Open verification ↗</button>');return;}
    details();
  }
  function details() {
    view('SEND TO AN EDGE USER',`<p>Minimum $1. Check the recipient carefully. Completed transfers cannot be cancelled.</p><form id="transfer-recipient-form" class="copy-funding-form"><label for="transfer-account">Recipient’s EDGE account number</label><input id="transfer-account" type="text" inputmode="numeric" autocomplete="off" pattern="[1-9][0-9]{9}" minlength="10" maxlength="10" placeholder="10-digit EDGE number" required><label for="transfer-amount">Amount (USD)</label><div class="amount-input"><span>$</span><input id="transfer-amount" type="number" inputmode="decimal" min="1" max="1000000" step="0.01" placeholder="0.00" required></div><p class="form-error" id="transfer-error" role="alert" hidden></p><button type="submit" class="button green wallet-submit">Check recipient ↗</button></form>`);
  }
  function review() {
    view('REVIEW YOUR TRANSFER',`<p>Confirm these details before sending. Only send to someone you recognise.</p><dl class="transfer-review"><div><dt>Recipient</dt><dd>${esc(intent.recipient.name)}</dd></div><div><dt>EDGE account</dt><dd>${esc(intent.recipient.account_number)}</dd></div><div><dt>Amount / total</dt><dd>${money(intent.amount)}</dd></div><div><dt>Transfer fee</dt><dd>$0.00</dd></div></dl><form id="transfer-send-form" class="copy-funding-form"><label for="transfer-password">Your current password</label><input id="transfer-password" type="password" autocomplete="current-password" maxlength="128" required><p class="form-error" id="transfer-error" role="alert" hidden></p><button type="submit" class="button green wallet-submit">Send ${money(intent.amount)} ↗</button></form><button class="auth-switch" type="button" data-transfer-edit>Change recipient or amount</button><p class="transfer-fine-print">Transfers complete immediately. If a connection fails, retry this confirmation or check history before starting another transfer.</p>`);
  }
  async function submit(form, operation) {
    if(pending)return;pending=true;
    modal.setAttribute('aria-busy','true');
    const accountEpoch=epoch,button=$('[type="submit"]',form),release=window.EdgeMotion?.busy?.(button,'Processing…');
    const controls=[...form.querySelectorAll('input,button')];controls.forEach(c=>c.disabled=true);form.setAttribute('aria-busy','true');
    $('#transfer-error').hidden=true;
    try {await operation(accountEpoch);} catch(error) {if(accountEpoch===epoch){const target=$('#transfer-error');if(target){target.hidden=false;target.textContent=Object.values(error.errors||{}).flat().join(' ')||error.message;}}}
    finally {if(accountEpoch===epoch){pending=false;modal.removeAttribute('aria-busy');}release?.();controls.forEach(c=>c.disabled=false);form.setAttribute('aria-busy','false');}
  }
  document.addEventListener('submit',event=>{
    const form=event.target;
    if(form.id==='transfer-recipient-form'){
      event.preventDefault();const number=$('#transfer-account').value.trim(),raw=$('#transfer-amount').value;
      submit(form,async accountEpoch=>{
        if(!/^[0-9]+(?:\.[0-9]{1,2})?$/.test(raw))throw new Error('Enter a dollar amount with at most two decimal places.');
        const amount=Math.round(Number(raw)*100);if(!Number.isSafeInteger(amount)||amount<100||amount>100000000)throw new Error('Enter an amount from $1 to $1,000,000.');
        const data=await api().request('/api/wallet/transfers/recipient',{method:'POST',body:{account_number:number}});
        if(accountEpoch!==epoch)return;
        intent={recipient:data.recipient,token:data.confirmation_token,amount,key:crypto.randomUUID()};review();
      });
    }
    if(form.id==='transfer-send-form'){
      event.preventDefault();const password=$('#transfer-password').value,transferIntent=intent;
      submit(form,async accountEpoch=>{
        const data=await api().request('/api/wallet/transfers',{method:'POST',body:{account_number:transferIntent.recipient.account_number,amount_cents:transferIntent.amount,confirmation_token:transferIntent.token,current_password:password,idempotency_key:transferIntent.key}});
        if(accountEpoch!==epoch)return;
        intent=null;page=1;lastLoaded=0;
        view('TRANSFER COMPLETE',`<p>${money(data.transfer.amount_cents)} sent to ${esc(data.transfer.counterparty.name)}.</p><p class="ledger-ref">${esc(data.transfer.reference)}</p><button class="button green" type="button" data-transfer-close>Done ↗</button>`);
        try {await api().refresh();await history(1);} catch (_) {const message=document.createElement('p');message.textContent='Transfer completed. Refresh your wallet to see the latest balance.';$('#transfer-content')?.append(message);}
      });
    }
  });
  document.addEventListener('click',async event=>{
    const button=event.target.closest('button');
    if(event.target===modal){close();return;}if(!button)return;
    if(button.hasAttribute('data-transfer-open'))open();
    if(button.hasAttribute('data-transfer-close'))close();
    if(button.hasAttribute('data-transfer-signin'))api()?.openAuth();
    if(button.hasAttribute('data-transfer-verify')){close();api().navigate('verification');}
    if(button.hasAttribute('data-transfer-edit')&&!pending){intent=null;details();}
    if(button.hasAttribute('data-transfer-refresh'))history();
    if(button.dataset.transferPage)history(page+(button.dataset.transferPage==='next'?1:-1));
    if(button.hasAttribute('data-transfer-copy')){
      try {await navigator.clipboard.writeText($('#internal-account-number').textContent);button.textContent='Copied';setTimeout(()=>{if(button.isConnected)button.textContent='Copy';},1800);}catch(_){const range=document.createRange();range.selectNodeContents($('#internal-account-number'));getSelection().removeAllRanges();getSelection().addRange(range);button.textContent='Select & copy';}
    }
  });
  document.addEventListener('keydown',event=>{
    if(modal.hidden)return;
    if(event.key==='Escape'){event.stopImmediatePropagation();close();}
    if(event.key==='Tab'){
      const items=[...modal.querySelectorAll('button:not([disabled]),input:not([disabled])')];if(!items.length)return;
      if(event.shiftKey&&document.activeElement===items[0]){event.preventDefault();items.at(-1).focus();}
      else if(!event.shiftKey&&document.activeElement===items.at(-1)){event.preventDefault();items[0].focus();}
    }
  },true);
  function accountChanged() {
    const next=api()?.user?.id||null;
    if(next!==identity){identity=next;++epoch;++serial;loading=false;pending=false;intent=null;page=1;lastLoaded=0;close(true);$('#transfer-content').replaceChildren();shell();}
    if(next&&active()&&Date.now()-lastLoaded>15000)history();
  }
  window.addEventListener('edge:session',accountChanged);
  window.addEventListener('edge:account-state',accountChanged);
  window.addEventListener('edge:navigate',()=>{if(active())history();else close();});
  shell();accountChanged();
})();
