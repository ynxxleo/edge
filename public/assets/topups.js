(() => {
  'use strict';
  const $=selector=>document.querySelector(selector),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(value)/100);
  const panel=$('#admin-topups-tab');if(!panel)return;
  let session={user:window.EdgeAPI?.user,serverMode:window.EdgeAPI?.serverMode===true},identity='',epoch=0,readSerial=0,historySerial=0,users=[],selected=null,intent=null,pending=false,historyPage=1,historyLast=1;
  const allowed=()=>session.serverMode&&session.user?.is_admin===true;
  const active=()=>allowed()&&!panel.hidden&&!$('#admin-page').hidden;
  const request=(path,options)=>{if(!allowed())throw new Error('Administrator access is required.');return window.EdgeAPI.request(path,options);};
  function feedback(message,error=false){const target=$('#topup-feedback');target.textContent=message;target.hidden=!message;target.classList.toggle('error',error);}
  function updateAccess(){
    $('#topup-access-note').hidden=allowed();$('#topup-workspace').hidden=!allowed();
    document.querySelectorAll('#topup-workspace input,#topup-workspace textarea,#topup-workspace button').forEach(control=>control.disabled=!allowed()||pending);
    $('[data-topup-page="previous"]').disabled=!allowed()||pending||historyPage<=1;
    $('[data-topup-page="next"]').disabled=!allowed()||pending||historyPage>=historyLast;
  }
  function clear(){
    ++epoch;++readSerial;++historySerial;users=[];selected=null;intent=null;pending=false;historyPage=1;historyLast=1;
    $('#topup-search-form').reset();$('#topup-draft-form').reset();$('#topup-draft-form').hidden=true;
    $('#topup-review').replaceChildren();$('#topup-review').hidden=true;$('#topup-selected-user').innerHTML='<p>Select an account to begin.</p>';
    $('#topup-user-results').replaceChildren();$('#topup-history-list').replaceChildren();$('#topup-pagination').hidden=true;
    $('#topup-search-status').hidden=true;$('#topup-history-status').hidden=true;feedback('');
  }
  function applySession(detail){
    session={user:detail.user,serverMode:detail.serverMode===true};const next=`${session.serverMode}:${session.user?.id||''}:${Boolean(session.user?.is_admin)}`;
    if(next!==identity){identity=next;clear();}updateAccess();if(active())load();
  }
  async function search(){
    if(!active())return;const seq=++readSerial,accountEpoch=epoch,status=$('#topup-search-status');status.hidden=false;status.textContent='Finding accounts…';
    try{
      const data=await request('/api/admin/top-ups/users?search='+encodeURIComponent($('#topup-search').value.trim()));
      if(seq!==readSerial||accountEpoch!==epoch||!active())return;users=data.users;
      $('#topup-user-results').innerHTML=users.length?users.map(user=>`<button type="button" class="topup-user" data-topup-user="${esc(user.id)}" ${pending?'disabled':''}><span><strong>${esc(user.name)}</strong><small>${esc(user.email)}</small><small>EDGE ${esc(user.account_number)}</small></span><span>${money(user.balance_cents)}<small>Select ↗</small></span></button>`).join(''):'<p class="topup-empty">No matching accounts. Try an email or account number.</p>';
      status.hidden=true;
    }catch(error){if(accountEpoch===epoch&&seq===readSerial){status.hidden=false;status.textContent=error.message;}}
  }
  async function history(page=historyPage){
    if(!active())return;const seq=++historySerial,accountEpoch=epoch,status=$('#topup-history-status');status.hidden=false;status.textContent='Loading top-ups…';
    try{
      const data=await request('/api/admin/top-ups?page='+page);if(seq!==historySerial||accountEpoch!==epoch||!active())return;
      historyPage=data.pagination.current_page;historyLast=data.pagination.last_page;
      $('#topup-history-list').innerHTML=data.topups.length?data.topups.map(t=>`<article class="topup-receipt"><div><h4>${esc(t.user.name)} <span>${money(t.amount_cents)}</span></h4><p>${esc(t.user.email)} · EDGE ${esc(t.user.account_number)}</p><p>By ${esc(t.admin.name)} · ${esc(new Date(t.created_at).toLocaleString())}</p><small>${esc(t.reference)}</small><p class="topup-reason">${esc(t.reason)}</p><p>Balance: ${money(t.balance_before_cents)} → ${money(t.balance_after_cents)}</p></div></article>`).join(''):'<p class="topup-empty">No administrator top-ups yet. Confirmed credits will appear here.</p>';
      $('#topup-pagination').hidden=data.pagination.last_page<=1;$('#topup-page-label').textContent=`Page ${historyPage} of ${data.pagination.last_page}`;
      $('[data-topup-page="previous"]').disabled=pending||historyPage<=1;$('[data-topup-page="next"]').disabled=pending||historyPage>=data.pagination.last_page;status.hidden=true;
    }catch(error){if(accountEpoch===epoch&&seq===historySerial){status.hidden=false;status.textContent=error.message;}}
  }
  function load(){search();history();}
  function select(id){
    if(pending||!active())return;selected=users.find(user=>String(user.id)===String(id));if(!selected)return;
    intent=null;$('#topup-draft-form').reset();$('#topup-draft-form').hidden=false;$('#topup-review').replaceChildren();$('#topup-review').hidden=true;feedback('');
    $('#topup-selected-user').innerHTML=`<strong>${esc(selected.name)}</strong><span>${esc(selected.email)}</span><span>EDGE ${esc(selected.account_number)}</span><span>Current available balance ${money(selected.balance_cents)}</span>`;$('#topup-amount').focus();
  }
  function review(){
    if(!selected||!active()||pending)return;
    const raw=$('#topup-amount').value,reason=$('#topup-reason').value.trim();
    if(!/^\d+(?:\.\d{1,2})?$/.test(raw)){feedback('Enter an amount with at most two decimal places.',true);return;}
    const amount=Math.round(Number(raw)*100);if(!Number.isSafeInteger(amount)||amount<100||amount>100000000){feedback('Enter an amount from $1 to $1,000,000.',true);return;}
    if(reason.length<3||reason.length>300){feedback('Enter a reason from 3 to 300 characters.',true);return;}
    const sameIntent=intent&&intent.user.id===selected.id&&intent.user.account_number===selected.account_number&&intent.amount===amount&&intent.reason===reason;
    intent={user:{...selected},amount,reason,key:sameIntent?intent.key:crypto.randomUUID()};$('#topup-draft-form').hidden=true;feedback('');
    $('#topup-review').hidden=false;$('#topup-review').innerHTML=`<h4>Confirm this credit</h4><dl><div><dt>Account</dt><dd>${esc(selected.name)}<br>${esc(selected.email)}<br>EDGE ${esc(selected.account_number)}</dd></div><div><dt>Credit</dt><dd>${money(amount)}</dd></div><div><dt>Admin reason</dt><dd>${esc(reason)}</dd></div></dl><form id="topup-confirm-form"><label for="topup-password">Your administrator password</label><input id="topup-password" type="password" autocomplete="current-password" maxlength="128" required><label class="topup-confirm-check"><input name="confirmed" type="checkbox" required>I confirm this user and amount. Add ${money(amount)} to their available wallet.</label><button class="button green" type="submit">Credit ${money(amount)} ↗</button><button class="text-button" type="button" data-topup-edit>Change details</button></form>`;$('#topup-password').focus();
  }
  async function credit(){
    if(pending||!active()||!intent)return;const form=$('#topup-confirm-form');if(!form.reportValidity())return;
    const accountEpoch=epoch,draft=intent,password=$('#topup-password').value;pending=true;updateAccess();feedback('Crediting account…');
    const release=window.EdgeMotion?.busy?.($('[type="submit"]',form),'Adding funds…');
    try{
      const data=await request('/api/admin/users/'+draft.user.id+'/top-ups',{method:'POST',body:{account_number:draft.user.account_number,amount_cents:draft.amount,reason:draft.reason,current_password:password,confirmed:true,idempotency_key:draft.key}});
      if(accountEpoch!==epoch||!allowed())return;
      intent=null;$('#topup-draft-form').reset();$('#topup-review').replaceChildren();$('#topup-review').hidden=true;$('#topup-draft-form').hidden=true;
      feedback(`${money(data.topup.amount_cents)} credited to ${data.topup.user.name}. Reference: ${data.topup.reference}`);
      $('#topup-selected-user').innerHTML='<p>Select an account for another top-up.</p>';selected=null;
      if(active()){search();history(1);}window.dispatchEvent(new CustomEvent('edge:admin-refresh'));window.dispatchEvent(new CustomEvent('edge:admin-topup'));
    }catch(error){if(accountEpoch===epoch){const details=Object.values(error.errors||{}).flat().join(' ');feedback(details||`${error.message} If the result is uncertain, check history or retry this same confirmation.`,true);}}
    finally{release?.();if(accountEpoch===epoch){pending=false;updateAccess();const field=$('#topup-password');if(field)field.value='';}}
  }
  panel.addEventListener('submit',event=>{event.preventDefault();if(event.target.id==='topup-search-form')search();if(event.target.id==='topup-draft-form')review();if(event.target.id==='topup-confirm-form')credit();});
  panel.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button||button.disabled||pending)return;
    if(button.dataset.topupUser)select(button.dataset.topupUser);
    if(button.hasAttribute('data-topup-edit')){$('#topup-review').replaceChildren();$('#topup-review').hidden=true;$('#topup-draft-form').hidden=false;feedback('');}
    if(button.id==='topup-history-refresh')history();if(button.dataset.topupPage)history(historyPage+(button.dataset.topupPage==='next'?1:-1));
  });
  window.addEventListener('edge:session',event=>applySession(event.detail||{}));
  window.addEventListener('edge:admin-tab',()=>{if(active())load();else{++readSerial;++historySerial;const field=$('#topup-password');if(field)field.value='';}});
  window.addEventListener('edge:navigate',()=>{if(active())load();else{++readSerial;++historySerial;const field=$('#topup-password');if(field)field.value='';}});
  $('#admin-refresh')?.addEventListener('click',()=>{if(active())load();});
  applySession(session);
})();
