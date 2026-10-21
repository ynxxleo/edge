(() => {
  'use strict';
  const serverMode=document.body.dataset.runtime==='laravel';
  if(!serverMode){window.EdgeAPI={serverMode:false,user:null,request:async()=>{throw new Error('Open the Laravel app to use the server.');},refresh:async()=>{}};window.dispatchEvent(new CustomEvent('edge:session',{detail:{user:null,serverMode:false}}));return;}
  const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon=n=>`<svg aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const money=(c,currency='USD')=>new Intl.NumberFormat('en-US',{style:'currency',currency}).format(Number(c||0)/100);
  const date=v=>v?new Date(v).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'—';
  const cents=v=>Math.round(Number(v)*100);
  const payout=(amount,legs)=>{let value=BigInt(Math.max(0,amount||0)),denominator=1n;for(const leg of legs){value*=BigInt(Math.round(Number(leg.expected_odds)*10000));denominator*=10000n;}return Number(value/denominator);};
  const key=()=>globalThis.crypto?.randomUUID?.()||`edge-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const pendingForms=new Set(),pendingActions=new Set();
  let openingWallet=false;
  function busy(button,label){
    if(window.EdgeMotion?.busy)return window.EdgeMotion.busy(button,label);
    if(!button)return ()=>{};
    const disabled=button.disabled,aria=button.getAttribute('aria-busy');button.disabled=true;button.setAttribute('aria-busy','true');
    return ()=>{button.disabled=disabled;if(aria===null)button.removeAttribute('aria-busy');else button.setAttribute('aria-busy',aria);};
  }
  async function action(button,label,operation,actionKey=button.id){
    if(button.disabled||pendingActions.has(actionKey))return;
    pendingActions.add(actionKey);const release=busy(button,label);
    try{return await operation();}finally{pendingActions.delete(actionKey);release();}
  }
  let user=null,csrf='',events=[],strategies=[],state={bets:[],transactions:[],copy_positions:[],wallet_requests:[],balance_cents:0,profit_cents:0},selections=[],betType='single',stake='',sport='all',league='all',query='',liveOnly=false,expanded=false,page='sports',betFilter='active',copyFilter='active',walletMode='deposit',lastFocus=null,toastTimer,refreshSequence=0;
  let otpChallenge=null,otpTimer;
  let betSubmissionKey=key();
  const copyChartSelection=new Map();
  let depositInstructions='Contact the platform administrator for verified bank transfer instructions. Submit the funding reference for review.';
  let walletPaymentMethods=null;
  let paymentMethods={stripe:{enabled:false,mode:'test'},manual:{enabled:true}};
  const returnParameters=new URL(location.href).searchParams;
  const stripeReturn=returnParameters.get('stripe_return');
  const stripeReturnReference=returnParameters.get('payment_ref');
  async function request(path,options={}){
    const headers={Accept:'application/json',...options.headers};
    let body=options.body;
    if(body&&typeof body!=='string'&&!(body instanceof FormData)){headers['Content-Type']='application/json';body=JSON.stringify(body);}
    if(options.method&&options.method!=='GET')headers['X-CSRF-TOKEN']=csrf;
    const release=options.method&&options.method!=='GET'?window.EdgeMotion?.network?.():null;
    try{
      const response=await fetch(path,{...options,body,headers,credentials:'same-origin'});
      const data=await response.json().catch(()=>({message:`The server returned ${response.status}.`}));
      if(!response.ok){if(response.status===401)clearAccount();const error=new Error(data.message||'The request could not be completed.');error.status=response.status;error.errors=data.errors;throw error;}
      if(data.csrf_token)csrf=data.csrf_token;
      if(typeof data.deposit_instructions==='string')depositInstructions=data.deposit_instructions;
      return data;
    }finally{release?.();}
  }
  window.EdgeAPI={serverMode:true,request,refresh,navigate,openAuth:auth,get user(){return user;}};
  const announceSession=()=>window.dispatchEvent(new CustomEvent('edge:session',{detail:{user,serverMode:true}}));
  const errors=e=>Object.values(e.errors||{}).flat().join(' ')||e.message;
  function clearAccount(){
    ++refreshSequence;user=null;state={bets:[],transactions:[],copy_positions:[],wallet_requests:[],balance_cents:0,profit_cents:0,active_stakes_cents:0,potential_returns_cents:0};
    selections=[];stake='';betSubmissionKey=key();copyChartSelection.clear();$('#header-popover').innerHTML='';$('#header-popover').hidden=true;closeModal(true);render();announceSession();
  }
  function toast(text){clearTimeout(toastTimer);$('#toast').textContent=text;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,6000);}
  function openModal(id){lastFocus=document.activeElement;$$('.modal-backdrop').forEach(m=>m.hidden=m.id!==id);document.body.style.overflow='hidden';$('button,input,select',document.getElementById(id))?.focus();}
  function closeModal(force=false){if(!force&&pendingForms.size)return;$$('#manual-withdraw-fields input,#manual-withdraw-fields textarea').forEach(input=>input.value='');$$('#manual-withdraw-fields select').forEach(input=>input.selectedIndex=0);$$('.modal-backdrop').forEach(m=>m.hidden=true);document.body.style.overflow='';if(lastFocus?.isConnected)lastFocus.focus();}
  function info(title,body){$('#info-content').innerHTML=`<span class="section-kicker">YOUR GAME. YOUR EDGE.</span><h2 id="info-title">${title}<span>.</span></h2>${body}`;openModal('info-modal');}
  function auth(mode='login'){
    if(pendingForms.size)return;
    if(otpChallenge){showOtp(otpChallenge);return;}
    request('/api/session').catch(e=>toast(errors(e)));
    info(mode==='login'?'WELCOME BACK':'JOIN THE GAME',`<p>${mode==='login'?'Sign in to manage your wallet and place stakes.':'Create your account. Use at least 12 characters, including letters and numbers. Your wallet starts at zero.'}</p><form id="auth-form" class="copy-funding-form" data-mode="${mode}">${mode==='register'?'<label for="auth-name">Full name</label><input id="auth-name" autocomplete="name" maxlength="100" required>':''}<label for="auth-email">Email</label><input id="auth-email" type="email" autocomplete="email" required maxlength="255"><label for="auth-password">Password</label><input id="auth-password" type="password" autocomplete="${mode==='register'?'new-password':'current-password'}" minlength="${mode==='register'?12:1}" required>${mode==='register'?'<label for="auth-confirmation">Confirm password</label><input id="auth-confirmation" type="password" autocomplete="new-password" minlength="12" required>':''}<p class="form-error" id="auth-error" role="alert" hidden></p><button class="button green wallet-submit" type="submit">${mode==='login'?'Sign in':'Create account'} ${icon('arrow')}</button></form><button class="auth-switch" data-auth="${mode==='login'?'register':'login'}">${mode==='login'?'New to EDGE? Create an account':'Already a member? Sign in'}</button>`);
  }
  function showOtp(challenge){
    otpChallenge=challenge;clearInterval(otpTimer);
    const resendAt=Date.now()+Number(challenge.resend_after||0)*1000;
    info('CHECK YOUR EMAIL',`<p>We sent a six-digit code to <strong>${esc(challenge.email_hint)}</strong>. Enter it below to finish signing in. The code expires in 10 minutes.</p><form id="otp-form" class="copy-funding-form"><label for="auth-code">Verification code</label><input id="auth-code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" placeholder="000000" required style="font-size:28px;letter-spacing:.35em;text-align:center"><p class="form-error" id="otp-error" role="alert" hidden></p><button class="button green wallet-submit" type="submit">Verify & continue ${icon('arrow')}</button></form><p class="otp-help">Check your spam folder if the email hasn’t arrived.</p><button class="auth-switch" id="otp-resend" type="button">Resend code</button><button class="auth-switch" id="otp-change" type="button">Use another account</button>`);
    const tick=()=>{const button=$('#otp-resend');if(!button||!button.isConnected){clearInterval(otpTimer);return;}const seconds=Math.max(0,Math.ceil((resendAt-Date.now())/1000));if(!pendingActions.has('otp-resend')){button.disabled=seconds>0;button.textContent=seconds?`Resend code in ${seconds}s`:'Resend code';}};
    tick();otpTimer=setInterval(tick,1000);$('#auth-code')?.focus();
  }
  function requireUser(){if(user)return true;auth();return false;}
  async function refresh(){
    const seq=++refreshSequence;
    const previousIdentity={id:user?.id,is_admin:user?.is_admin};
    const [ev,st,account,methods]=await Promise.all([request('/api/events'),request('/api/copy/strategies'),user?request('/api/state'):Promise.resolve(null),request('/api/payment-methods')]);
    if(seq!==refreshSequence)return;
    events=ev.events||ev.data||[];strategies=st.strategies||st.data||[];
    if(account){state=account;user=account.user||user;}
    paymentMethods=methods;
    render();
    window.dispatchEvent(new CustomEvent('edge:account-state',{detail:{user}}));
    if(previousIdentity.id!==user?.id||previousIdentity.is_admin!==user?.is_admin)announceSession();
  }
  const balance=()=>Number(state.balance_cents||0);
  const positions=()=>state.copy_positions||[];
  const getEvent=id=>events.find(e=>String(e.id)===String(id));
  const getStrategy=id=>strategies.find(s=>String(s.id)===String(id)||s.slug===String(id));
  const outcomeLabel=(event,outcome)=>outcome==='home'?`${event.home_name} to win`:outcome==='away'?`${event.away_name} to win`:'Draw';
  function render(){
    $$('[data-balance]').forEach(el=>el.textContent=user?money(balance()):'$0.00');
    $$('[data-profit]').forEach(el=>el.textContent=money(state.profit_cents));
    $$('[data-stakes]').forEach(el=>el.textContent=money(state.active_stakes_cents));
    $$('[data-returns]').forEach(el=>el.textContent=money(state.potential_returns_cents));
    const active=(state.bets||[]).filter(b=>b.status==='pending');
    $('#bets-count').textContent=active.length;$('#active-bet-count').textContent=active.length;
    $('#admin-nav').hidden=!user?.is_admin;
    $('#profile-button').textContent=user?user.name.split(' ').map(s=>s[0]).slice(0,2).join('').toUpperCase():'↗';
    $('#profile-button').setAttribute('aria-label',user?'Open account menu':'Sign in');
    $$('.demo-badge').forEach(el=>el.textContent='USD');
    $$('.wallet-security').forEach(el=>el.innerHTML=`${icon('lock')} ACCOUNT BALANCE · SERVER VERIFIED`);
    $$('.copy-demo-note').forEach(el=>el.innerHTML=`<span class="demo-badge">COPY STAKING</span><p>Strategies copy picks published by an administrator. Final scores settle copied stakes. Returns can vary and stakes can be lost.</p>`);
    $('.copy-performance-note').textContent='Follow your capital from the first deposit through every settled game. Wins add net profit, losses subtract your copied stake, and pending games leave the chart unchanged.';
    $('.demo-explanation').textContent='Card deposits are credited after Stripe confirms payment. Manual deposits need administrator verification. Withdrawal funds are reserved during review.';
    $('.wallet-profit>span:last-child').textContent='Settled profit / loss';
    $$('.header-deposit').forEach(el=>el.innerHTML=`${icon('plus')} Deposit`);
    $$('.activity-strip>span:nth-child(2)').forEach(el=>el.innerHTML=`${events.filter(e=>e.status==='live').length} <small>live events</small>`);
    $$('.activity-strip>span:nth-child(3)').forEach(el=>el.innerHTML=`${new Set(events.map(e=>e.sport)).size} <small>sports available</small>`);
    $$('[data-sport]').forEach(b=>{const count=$('span',b);if(count)count.textContent=events.filter(e=>(b.dataset.sport==='all'||e.sport===b.dataset.sport)&&['open','live'].includes(e.status)).length;});
    renderEvents();renderSlip();renderBets();renderTransactions();renderCopy();renderRequests();renderCardPayments();
  }
  function renderEvents(){
    const filtered=events.filter(e=>(sport==='all'||e.sport===sport)&&(league==='all'||e.league===league)&&(!liveOnly||e.status==='live')&&(!query||`${e.home_name} ${e.away_name} ${e.league}`.toLowerCase().includes(query.toLowerCase())));
    const list=expanded?filtered:filtered.slice(0,6);
    $('#match-list').innerHTML=list.length?list.map(e=>{
      const enabled=e.status==='open'&&new Date(e.starts_at)>new Date();
      return `<article class="match-card"><div class="match-meta">${icon(e.sport==='esports'?'game':e.sport)}<span>${esc(e.country)} / ${esc(e.league)}</span>${e.status==='live'?'<span class="live-tag">LIVE</span>':`<span class="match-time">${['finished','void','suspended'].includes(e.status)?esc(e.status.toUpperCase()):date(e.starts_at)}</span>`}</div><div class="match-main"><div class="match-teams"><div class="team-row"><span class="team-crest">${esc(e.home_name.slice(0,2).toUpperCase())}</span><span>${esc(e.home_name)}</span></div><div class="team-row"><span class="team-crest">${esc(e.away_name.slice(0,2).toUpperCase())}</span><span>${esc(e.away_name)}</span></div></div><div class="score-column"><span>${e.home_score??'–'}</span><span>${e.away_score??'–'}</span></div><div class="odds-group">${['home','draw','away'].map((o,i)=>`<button class="odds-button ${selections.some(s=>String(s.event_id)===String(e.id)&&s.outcome===o)?'selected':''}" data-server-odds="${e.id}" data-outcome="${o}" ${!enabled||!e[`odds_${o}`]?'disabled':''}><span>${['1','X','2'][i]}</span><strong>${e[`odds_${o}`]?Number(e[`odds_${o}`]).toFixed(2):'—'}</strong></button>`).join('')}</div></div></article>`;
    }).join(''):`<div class="empty-events">${icon('clock')}<h3>No games available here yet.</h3><p>Published games and results appear here when an administrator updates them.</p></div>`;
    $('#view-all-events').hidden=filtered.length<=6;
    $('#view-all-events').innerHTML=`${expanded?'Show fewer':'View all events'} (${filtered.length}) ${icon('arrow')}`;
    $('#market-title').innerHTML=`${liveOnly?'Live events':'Games & results'}<span class="green-text">.</span>`;
  }
  function selectEvent(id,outcome){
    const e=getEvent(id);if(!e||!e[`odds_${outcome}`])return;
    const old=selections.find(s=>String(s.event_id)===String(id));
    selections=selections.filter(s=>String(s.event_id)!==String(id));
    if(betType==='single')selections=[];
    if(old?.outcome!==outcome)selections.push({event_id:e.id,outcome,expected_odds:String(e[`odds_${outcome}`]),expected_version:e.version,title:outcomeLabel(e,outcome),match:`${e.home_name} vs ${e.away_name}`});
    betSubmissionKey=key();renderEvents();renderSlip();
    if(old?.outcome!==outcome)$$('[data-server-odds]').find(button=>String(button.dataset.serverOdds)===String(id)&&button.dataset.outcome===outcome)?.classList.add('edge-odds-selected');
  }
  function renderSlip(){
    if(pendingForms.has('server-stake-form')&&$('#server-stake-form'))return;
    $('#slip-count').textContent=selections.length;$('#mobile-slip-count').textContent=selections.length;
    $$('[data-bet-type]').forEach(b=>b.classList.toggle('active',b.dataset.betType===betType));
    if(!selections.length){$('#slip-content').innerHTML=`<div class="empty-slip"><div class="empty-slip-icon">${icon('wallet')}<span>+</span></div><h4>Your next move starts here.</h4><p>Select an available outcome.<br>Accepted odds are saved with your stake.</p></div>`;return;}
    const multiple=betType==='multiple',total=multiple?Number(stake||0):Number(stake||0)*selections.length,returns=multiple?payout(cents(stake),selections):selections.reduce((n,s)=>n+payout(cents(stake),[s]),0);
    $('#slip-content').innerHTML=`<div class="slip-selections">${selections.map(s=>`<div class="slip-selection"><button class="remove-selection" data-server-remove="${s.event_id}" aria-label="Remove selection">${icon('close')}</button><h4>${esc(s.title)}</h4><p>${esc(s.match)}</p><div class="selection-market"><span>Match winner</span><strong>${Number(s.expected_odds).toFixed(2)}</strong></div></div>`).join('')}</div><form id="server-stake-form" class="stake-form" data-key="${betSubmissionKey}"><label for="server-stake">${multiple?'Stake amount':'Stake per selection'} <span>USD</span></label><div class="stake-input"><span>$</span><input id="server-stake" type="number" min="1" max="1000000" step=".01" value="${esc(stake)}" required></div><div class="stake-presets"><button type="button" data-server-stake="500">+500</button><button type="button" data-server-stake="1000">+1,000</button><button type="button" data-server-stake="5000">+5,000</button></div><div class="slip-summary"><span>Total stake</span><strong id="server-total-stake">${money(cents(total))}</strong></div><div class="slip-summary return-row"><span>Potential return</span><strong id="server-potential">${money(returns)}</strong></div><p class="slip-error" id="server-slip-error" role="alert" hidden></p><button type="submit" class="button green stake-submit">${user?'Place stake':'Sign in to stake'} ${icon('arrow')}</button><button type="button" class="clear-slip" id="server-clear-slip">Clear bet slip</button></form>`;
  }
  function renderBets(){
    const list=(state.bets||[]).filter(b=>betFilter==='all'||(betFilter==='active'?b.status==='pending':b.status!=='pending'));
    $('#bet-history').innerHTML=list.length?list.map(b=>`<article class="history-card"><div class="history-top"><span>${esc(b.reference)} · ${date(b.created_at)}</span><span class="history-status">${esc(b.status.toUpperCase())}</span></div><h3>${b.type==='multiple'?`${b.selections?.length||0}-selection multiple`:'Single stake'}</h3>${(b.selections||[]).map(s=>`<p>${esc(s.home_name||s.event?.home_name)} vs ${esc(s.away_name||s.event?.away_name)}<br>${esc(s.outcome.toUpperCase())} · ${Number(s.odds).toFixed(2)} · ${esc(s.status)}</p>`).join('')}<div class="history-values"><div><span>STAKE</span><strong>${money(b.stake_cents)}</strong></div><div><span>${b.status==='pending'?'POTENTIAL RETURN':'SETTLED RETURN'}</span><strong class="green-text">${money(b.status==='pending'?b.potential_return_cents:b.payout_cents)}</strong></div></div><p class="server-bet-note">${b.status==='pending'?'Settles after the administrator publishes final results.':'Settlement recorded in your wallet ledger.'}</p></article>`).join(''):`<div class="empty-history">${user?'No stakes in this category yet.':'Sign in to view your stakes.'}</div>`;
  }
  function renderTransactions(){
    const filter=$('#transaction-filter').value;
    const list=(state.transactions||[]).filter(t=>filter==='all'||(filter==='return'?['payout','refund'].includes(t.type):filter==='copy'?t.type.startsWith('copy'):t.type===filter));
    $('#transaction-body').innerHTML=list.length?list.map(t=>`<tr><td>${esc(t.type==='promo_credit'?'Promotional credit':t.type.replaceAll('_',' '))}<small class="ledger-ref">${esc(t.reference)}</small></td><td>${date(t.created_at)}</td><td class="${t.amount_cents>=0?'amount-positive':'amount-negative'}">${t.amount_cents>=0?'+':'−'}${money(Math.abs(t.amount_cents))}</td><td><span class="transaction-status">Recorded</span></td></tr>`).join(''):'<tr><td colspan="4">No transactions yet.</td></tr>';
  }
  function renderRequests(){
    let section=$('#server-wallet-requests');
    if(!section){section=document.createElement('section');section.id='server-wallet-requests';section.className='server-requests';$('#wallet-page').append(section);}
    section.innerHTML=`<h3>Deposit & withdrawal requests</h3>${(state.wallet_requests||[]).length?`<div class="transaction-table-wrap"><table class="transaction-table"><thead><tr><th>REQUEST</th><th>AMOUNT</th><th>STATUS</th><th>CREATED</th></tr></thead><tbody>${state.wallet_requests.map(r=>`<tr><td>${esc(r.type)}${r.method_name?` · ${esc(r.method_name)}`:''}<small class="ledger-ref">${esc(r.reference)}</small></td><td>${money(r.amount_cents)}</td><td><span class="transaction-status">${esc(r.status)}</span></td><td>${date(r.created_at)}</td></tr>`).join('')}</tbody></table></div>`:'<p>Requests appear here. Only approved deposits are credited; withdrawal funds are reserved during review.</p>'}`;
  }
  const signedMoney=value=>`${value>0?'+':value<0?'−':''}${money(Math.abs(value))}`;
  const copyResultLabel=status=>({won:'Won',lost:'Lost',void:'Refunded',pending:'Pending',deposit:'Deposit'}[status]||'Pending');
  const copyTone=value=>value>0?'positive':value<0?'negative':'neutral';
  function copyPerformance(position){
    const supplied=position.performance||{};
    const initial=Number(supplied.initial_deposit_cents??position.principal_cents??0);
    const points=(supplied.points||[]).filter(point=>Number.isFinite(Number(point.value_cents))).map(point=>({...point,value_cents:Number(point.value_cents),change_cents:Number(point.change_cents||0)}));
    if(!points.length)points.push({id:'deposit',type:'deposit',recorded_at:position.created_at,value_cents:initial,change_cents:0,label:'Initial deposit',status:'deposit'});
    const current=points.at(-1).value_cents;
    const games=supplied.games||(position.stakes||[]).map(game=>({...game,home_name:game.home_name||game.event?.home_name,away_name:game.away_name||game.event?.away_name,net_change_cents:game.status==='pending'?null:Number(game.payout_cents||0)-Number(game.stake_cents||0)}));
    return {initial,current,profit:current-initial,percentage:initial?(current-initial)/initial*100:0,points,games};
  }
  function copyPointDescription(point){
    const label=point.type==='deposit'?'Initial deposit':`${point.label||'Copied game'} · ${copyResultLabel(point.status)}`;
    const detail=point.type==='deposit'?'Starting capital':`${copyResultLabel(point.status)} · ${signedMoney(point.change_cents)} net change`;
    return {label,detail,date:date(point.recorded_at)};
  }
  function renderCopyChart(position,performance){
    const {points,initial}=performance;
    const id=String(position.id),chartId=`copy-equity-${id.replace(/[^a-zA-Z0-9_-]/g,'')}`;
    const width=720,height=246,left=66,right=694,top=25,bottom=216;
    const values=points.map(point=>point.value_cents),lowest=Math.min(initial,...values),highest=Math.max(initial,...values);
    const range=Math.max(highest-lowest,initial*.12,100),minimum=Math.max(0,lowest-range*.32),maximum=highest+range*.32,span=maximum-minimum;
    const x=index=>points.length>1?left+index/(points.length-1)*(right-left):left;
    const y=value=>bottom-(value-minimum)/span*(bottom-top);
    const coordinates=points.map((point,index)=>({x:x(index),y:y(point.value_cents)}));
    const line=points.length>1?coordinates.map((point,index)=>`${index?'L':'M'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' '):`M${left},${y(initial).toFixed(2)} L${right},${y(initial).toFixed(2)}`;
    const area=`${line} L${right},${bottom} L${left},${bottom} Z`;
    const selection=copyChartSelection.get(id),selectedIndex=Math.max(0,selection?points.findIndex(point=>String(point.id)===selection):points.length-1);
    const selected=points[selectedIndex],description=copyPointDescription(selected);
    const compact=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:1}).format(value/100);
    return `<section class="copy-equity" data-copy-performance="${esc(id)}" aria-label="${esc(position.strategy?.name||position.strategy_name)} capital performance">
      <div class="copy-equity-toolbar"><div><span>YOUR CAPITAL / USD</span><h4>Every game. Every move.</h4></div><span class="copy-equity-verified">${icon('lock')} SETTLED RESULTS</span></div>
      <div class="copy-equity-readout" data-copy-chart-readout aria-live="polite" aria-atomic="true"><div><span data-copy-point-label>${esc(description.label)}</span><strong data-copy-point-value>${money(selected.value_cents)}</strong></div><div class="copy-equity-readout-detail"><span data-copy-point-detail class="${copyTone(selected.change_cents)}">${esc(description.detail)}</span><time data-copy-point-date>${esc(description.date)}</time></div></div>
      <div class="copy-equity-chart"><svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-labelledby="${chartId}-title ${chartId}-description"><title id="${chartId}-title">${esc(position.strategy?.name||position.strategy_name)} capital history</title><desc id="${chartId}-description">Started at ${money(initial)}. Latest settled value ${money(performance.current)}. Each point is an actual settled result. Pending games do not change this chart. Use the point buttons or the games below to inspect results.</desc><defs><linearGradient id="${chartId}-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#00ed8b" stop-opacity=".25"/><stop offset="100%" stop-color="#00ed8b" stop-opacity="0"/></linearGradient></defs>${[maximum,(maximum+minimum)/2,minimum].map(value=>`<line class="copy-equity-grid" x1="${left}" x2="${right}" y1="${y(value).toFixed(2)}" y2="${y(value).toFixed(2)}"/><text class="copy-equity-axis" x="0" y="${(y(value)+3).toFixed(2)}">${esc(compact(value))}</text>`).join('')}<path class="copy-equity-area" d="${area}" fill="url(#${chartId}-fill)"/><line class="copy-equity-baseline" x1="${left}" x2="${right}" y1="${y(initial).toFixed(2)}" y2="${y(initial).toFixed(2)}"/><path class="copy-equity-line" d="${line}"/>${coordinates.map((point,index)=>`<circle class="copy-equity-dot ${points[index].status==='lost'?'lost':''}" cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="3.5"/>`).join('')}</svg>${points.map((point,index)=>{const detail=copyPointDescription(point);return `<button type="button" class="copy-equity-point ${point.status==='lost'?'lost':''}" data-copy-chart-point="${index}" data-copy-position="${esc(id)}" data-copy-point-id="${esc(point.id)}" data-point-value="${point.value_cents}" data-point-change="${point.change_cents}" data-point-label="${esc(detail.label)}" data-point-detail="${esc(detail.detail)}" data-point-date="${esc(detail.date)}" aria-label="${esc(`${detail.label}. Capital ${money(point.value_cents)}. ${detail.detail}. ${detail.date}`)}" aria-pressed="${index===selectedIndex}" style="left:${(coordinates[index].x/width*100).toFixed(4)}%;top:${(coordinates[index].y/height*100).toFixed(4)}%"><span></span></button>`;}).join('')}</div>
      <div class="copy-equity-timeline"><span>DEPOSIT · ${esc(date(points[0].recorded_at))}</span><span>${points.length>1?'LATEST RESULT':'AWAITING FIRST RESULT'}${points.length>1?` · ${esc(date(points.at(-1).recorded_at))}`:''}</span></div>
      <div class="copy-equity-legend"><span><i></i>Capital after each result</span><span><i></i>Initial deposit ${money(initial)}</span></div>
      <p class="copy-equity-note">${points.length===1?'Your chart starts with your deposit. ':''}Wins add net profit. Losses subtract the copied stake. Pending games leave the line unchanged.</p>
    </section>`;
  }
  function renderCopyGames(performance){
    const games=performance.games;
    const pending=games.filter(game=>game.status==='pending').length;
    return `<div class="copy-master-history"><div class="copy-master-heading"><div><span class="section-kicker">FOLLOW THE RESULTS</span><h4>Master’s games<span>.</span></h4></div><span>${games.length-pending} settled / ${pending} pending</span></div>${games.length?`<ol class="copy-master-games" aria-label="Copied games, newest first">${games.map(game=>`<li data-copy-game="${esc(game.id)}" data-status="${esc(game.status)}"><div class="copy-game-teams"><strong>${esc(game.home_name||'Home team')} <span>vs</span> ${esc(game.away_name||'Away team')}</strong><small>${esc(date(game.settled_at||game.created_at))} · ${esc(String(game.outcome||'').toUpperCase())} · ${Number(game.odds||0).toFixed(2)} odds</small></div><span class="copy-game-status ${esc(game.status)}">${copyResultLabel(game.status)}</span><div class="copy-game-change ${game.net_change_cents===null?'neutral':copyTone(Number(game.net_change_cents))}"><strong>${game.net_change_cents===null?'Awaiting result':signedMoney(Number(game.net_change_cents))}</strong><small>${game.net_change_cents===null?`${money(game.stake_cents)} stake`:'net change'}</small></div></li>`).join('')}</ol>`:'<div class="copy-master-empty">Your master’s next copied game will appear here, with its result and the change to your capital.</div>'}</div>`;
  }
  function renderCopyPosition(position){
    const performance=copyPerformance(position),profitTone=copyTone(performance.profit),pending=position.pending_stakes_count??(position.stakes||[]).filter(game=>game.status==='pending').length;
    return `<article class="copy-position-card copy-performance-card" data-copy-position="${esc(position.id)}"><div class="copy-position-top"><div><span class="section-kicker">POSITION ${esc(position.id)} / ${esc(date(position.created_at))}</span><h3>${esc(position.strategy?.name||position.strategy_name)}</h3></div><span class="copy-status ${esc(position.status)}">${esc(position.status)}</span></div><div class="copy-position-values"><div><span>ORIGINAL DEPOSIT</span><strong>${money(performance.initial)}</strong></div><div><span>${position.status==='closed'?'FINAL CAPITAL':'CURRENT CAPITAL'}</span><strong>${money(performance.current)}</strong></div><div><span>PROFIT / LOSS</span><strong class="${profitTone}">${signedMoney(performance.profit)}<small>${performance.percentage>0?'+':''}${performance.percentage.toFixed(2)}%</small></strong></div></div>${renderCopyChart(position,performance)}${renderCopyGames(performance)}<p class="server-bet-note">${position.status==='closed'?'Position closed. Final capital was returned to your wallet.':`${money(position.value_cents)} available · ${pending} unsettled copied ${pending===1?'stake':'stakes'}`}</p>${position.status!=='closed'?`<div class="copy-position-actions"><button class="button outline" data-server-copy-status="${position.id}" data-status="${position.status==='paused'?'active':'paused'}">${position.status==='paused'?'Resume':'Pause'}</button><button class="button outline" data-server-copy-close="${position.id}">Return to wallet ${icon('arrow')}</button></div>`:''}</article>`;
  }
  function selectCopyChartPoint(button){
    const chart=button.closest('[data-copy-performance]');if(!chart)return;
    $$('[data-copy-chart-point]',chart).forEach(point=>point.setAttribute('aria-pressed',String(point===button)));
    copyChartSelection.set(button.dataset.copyPosition,button.dataset.copyPointId);
    $('[data-copy-point-label]',chart).textContent=button.dataset.pointLabel;
    $('[data-copy-point-value]',chart).textContent=money(Number(button.dataset.pointValue));
    const detail=$('[data-copy-point-detail]',chart);detail.textContent=button.dataset.pointDetail;detail.className=copyTone(Number(button.dataset.pointChange));
    $('[data-copy-point-date]',chart).textContent=button.dataset.pointDate;
  }
  function renderCopy(){
    const risk=$('#copy-risk-filter').value;
    $('#copy-strategy-list').innerHTML=strategies.filter(s=>risk==='all'||s.risk===risk).map(s=>`<article class="copy-strategy-card"><div class="copy-strategy-top"><span class="copy-avatar">${esc(s.name.split(' ').map(x=>x[0]).slice(0,2).join(''))}</span><div><span class="copy-strategy-tag">${esc(s.sport)}</span><h3 class="copy-strategy-name">${esc(s.name)}</h3></div><span class="copy-risk ${esc(s.risk)}">${esc(s.risk)}</span></div><p class="copy-strategy-description">${esc(s.description)}</p><div class="copy-metrics"><div><span>STAKE SIZE</span><strong>${Number(s.stake_percentage||2)}%</strong></div><div><span>MARKET</span><strong>1X2</strong></div><div><span>FUNDING</span><strong>Wallet</strong></div></div><p class="copy-funding-note">Copies administrator-published picks. Your accepted odds are saved and final scores determine settlement.</p><div class="copy-strategy-footer"><div><span>Minimum allocation</span><strong>${money(s.min_deposit_cents||10000)}</strong></div><button class="button green" data-server-copy-fund="${s.id}">Fund & copy ${icon('arrow')}</button></div></article>`).join('')||'<div class="empty-history">No active strategies are available.</div>';
    const open=positions().filter(p=>p.status!=='closed');
    $('#copy-total-allocated').textContent=money(open.reduce((n,p)=>n+Number(p.equity_cents??p.value_cents),0));
    $('#copy-total-profit').textContent=money(positions().reduce((n,p)=>n+Number(p.profit_cents||0),0));$('#copy-active-count').textContent=open.filter(p=>p.status==='active').length;
    const focused=document.activeElement?.closest('[data-copy-chart-point]'),focusPoint=focused?{position:focused.dataset.copyPosition,id:focused.dataset.copyPointId}:null;
    $('#copy-position-list').innerHTML=positions().filter(p=>copyFilter==='all'||p.status!=='closed').map(renderCopyPosition).join('')||'<div class="copy-empty"><h3>Your shared edge starts here.</h3><p>Fund a strategy from your wallet to copy future published picks.</p></div>';
    if(focusPoint)$$('[data-copy-chart-point]').find(point=>point.dataset.copyPosition===focusPoint.position&&point.dataset.copyPointId===focusPoint.id)?.focus({preventScroll:true});
  }
  function renderCardPayments(){
    let section=$('#server-card-payments');
    if(!section){section=document.createElement('section');section.id='server-card-payments';section.className='server-requests';$('#wallet-page').append(section);}
    const payments=state.stripe_payments||[];
    const returned=payments.find(p=>p.reference===stripeReturnReference);
    const banner=stripeReturn?`<div class="payment-return ${returned?.status==='paid'?'confirmed':''}" role="status"><strong>${stripeReturn==='cancel'?'Checkout canceled':returned?.status==='paid'?'Card deposit confirmed':'Waiting for card payment confirmation'}</strong><p>${stripeReturn==='cancel'?'No wallet credit is made for an unpaid checkout. You can try another method.':returned?.status==='paid'?'Your verified deposit is recorded in the wallet ledger.':user?'Wallet credit appears only after a verified Stripe payment confirmation. Use Refresh status to check again.':'Sign in to see your payment status.'}</p><button class="button outline" id="refresh-card-payments">Refresh status ${icon('clock')}</button></div>`:'';
    section.innerHTML=banner+`<h3>Card payments</h3>${payments.length?`<div class="transaction-table-wrap"><table class="transaction-table"><thead><tr><th>PAYMENT</th><th>AMOUNT</th><th>STATUS</th><th>CREATED</th></tr></thead><tbody>${payments.map(p=>`<tr><td>Stripe card <span class="payment-mode-tag">${esc(p.mode)}</span><small class="ledger-ref">${esc(p.reference)}</small></td><td>${money(p.amount_cents,p.currency||'USD')}</td><td><span class="transaction-status">${esc(p.status)}</span></td><td>${date(p.created_at)}</td></tr>`).join('')}</tbody></table></div>`:'<p>Stripe card payments appear here. A checkout redirect alone never changes your balance.</p>'}`;
  }
  function selectedManualMethod(){
    const methods=walletPaymentMethods||paymentMethods;
    const value=$('#wallet-method').value;
    return (methods.manual_methods||[]).find(item=>'manual:'+item.id===value&&item.enabled&&item[walletMode==='withdraw'?'withdrawal_enabled':'deposit_enabled']);
  }
  function updateWalletMethod(){
    const methods=walletPaymentMethods||paymentMethods,withdraw=walletMode==='withdraw';
    const card=!withdraw&&$('#wallet-method').value==='stripe',chosen=selectedManualMethod();
    const legacy=!methods.manual_catalog_configured&&$('#wallet-method').value==='bank_transfer';
    const available=card?Boolean(methods.stripe?.enabled):Boolean(chosen)||(legacy&&(withdraw||Boolean(methods.manual?.enabled)));
    $('#server-funding-reference').hidden=withdraw||card||!available;
    $('#server-payment-reference').required=!withdraw&&!card&&available;
    $('#server-payment-reference').disabled=withdraw||card||!available;
    const manual=methods.manual||{},destination=$('#manual-payment-details');
    destination.hidden=card||!available||(withdraw&&!chosen);
    if(chosen){
      const image=/^\/api\/manual-payment-methods\/[0-9]+\/image\?v=[0-9]+$/.test(chosen.image_url||'')?`<img src="${esc(chosen.image_url)}" alt="${esc(chosen.name)}" class="manual-method-logo">`:'';
      destination.innerHTML=`<div class="manual-chosen-heading">${image}<strong>${esc(chosen.name)}</strong></div><p class="manual-method-instructions">${esc(chosen.instructions)}</p>`;
    }else{
      const fields=[['Bank',manual.bank_name],['Account name',manual.account_name],['Account number',manual.account_number]];
      destination.innerHTML=fields.filter(([,value])=>value).map(([label,value])=>`<div><span>${label}</span><strong>${esc(value)}</strong></div>`).join('')+(manual.support_contact?`<p>Payment help: ${esc(manual.support_contact)}</p>`:'');
    }
    const oldBank=withdraw&&legacy;
    $('#withdraw-fields').hidden=!oldBank;
    ['bank-name','account-number','account-name'].forEach(id=>{$('#'+id).required=oldBank;$('#'+id).disabled=!oldBank;});
    let custom=$('#manual-withdraw-fields');
    if(!custom){custom=document.createElement('div');custom.id='manual-withdraw-fields';$('#withdraw-fields').after(custom);}
    custom.hidden=!withdraw||!chosen;
    custom.innerHTML=withdraw&&chosen?(chosen.fields||[]).map(field=>{
      const id='payment-answer-'+field.key,attrs=`id="${esc(id)}" data-payment-field="${esc(field.key)}" ${field.required?'required':''} ${field.hint?`aria-describedby="${esc(id)}-hint"`:''}`;
      const control=field.type==='select'?`<select ${attrs}><option value="">Choose an option</option>${(field.options||[]).map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join('')}</select>`:field.type==='textarea'?`<textarea ${attrs} maxlength="1500" rows="3"></textarea>`:`<input ${attrs} type="${field.type==='email'?'email':'text'}" maxlength="500" autocomplete="off">`;
      return `<div class="manual-answer-field"><label for="${esc(id)}">${esc(field.label)}${field.required?' *':' (optional)'}</label>${control}${field.hint?`<small id="${esc(id)}-hint">${esc(field.hint)}</small>`:''}</div>`;
    }).join(''):'';
    $('label',$('#server-funding-reference')).textContent=chosen?'Payment / transaction reference':manual.reference_label||'Funding reference';
    $('#wallet-modal-description').textContent=!available?'No payment methods are currently available for this action.':withdraw?'Funds are reserved while an administrator reviews and processes your withdrawal.':card?'Pay securely on Stripe’s hosted card checkout. Your wallet is credited after verified payment confirmation.':chosen?'Follow the payment instructions below, then submit your transaction reference for review.':manual.instructions||depositInstructions;
    $('#wallet-amount').max=withdraw?balance()/100:card?999999.99:1000000;
    $('#wallet-submit').innerHTML=`${withdraw?'Submit withdrawal request':card?'Continue with card':'Submit manual deposit request'} ${icon('arrow')}`;
    $('#wallet-submit').disabled=!available;
    $('.modal-fine-print',$('#wallet-modal')).textContent=card?`${methods.stripe?.mode==='test'?'Stripe test mode · ':''}Card details are entered on Stripe. They are not stored by EDGE.`:'Manual payments are verified and processed by an administrator. Submitting a request does not send a payment.';
    $('#wallet-error').hidden=true;
  }
  async function wallet(mode,trigger){
    if(openingWallet||pendingForms.size||!requireUser())return;
    openingWallet=true;const release=busy(trigger,'Loading…');
    try{
    if(mode==='withdraw'&&user.kyc_status!=='approved'){
      const result=await request('/api/kyc');
      if(result.kyc.status!=='approved'){closeModal(true);navigate('verification');toast('Complete identity verification and wait for administrator approval before withdrawing.');return;}
      user={...user,kyc_status:'approved'};
      window.dispatchEvent(new CustomEvent('edge:account-state',{detail:{user}}));
    }
    try{paymentMethods=await request('/api/payment-methods');}catch(e){toast('Payment methods could not be loaded. Please try again.');return;}
    walletMode=mode;const withdraw=mode==='withdraw';
    $('#wallet-modal-title').innerHTML=`${withdraw?'REQUEST A WITHDRAWAL':'FUND YOUR WALLET'}<span>.</span>`;
    $$('[data-modal-wallet]').forEach(b=>b.classList.toggle('active',b.dataset.modalWallet===mode));
    walletPaymentMethods=JSON.parse(JSON.stringify(paymentMethods));
    const stripe=walletPaymentMethods.stripe||{},manual=walletPaymentMethods.manual||{};
    const custom=(walletPaymentMethods.manual_methods||[]).filter(item=>item.enabled&&item[withdraw?'withdrawal_enabled':'deposit_enabled']);
    const legacy=walletPaymentMethods.manual_catalog_configured?'':withdraw?'<option value="bank_transfer">Bank transfer · manual review</option>':manual.enabled?'<option value="bank_transfer">Manual bank payment</option>':'';
    const options=(!withdraw&&stripe.enabled?`<option value="stripe">Card via Stripe${stripe.mode==='test'?' · test mode':''}</option>`:'')+legacy+custom.map(item=>`<option value="manual:${Number(item.id)}">${esc(item.name)} · manual review</option>`).join('');
    $('#wallet-method').innerHTML=options||'<option value="">No payment methods available</option>';
    let reference=$('#server-funding-reference');
    if(!reference){reference=document.createElement('div');reference.id='server-funding-reference';reference.innerHTML='<label for="server-payment-reference">Funding reference</label><input id="server-payment-reference" maxlength="160" placeholder="Your payment / funding reference">';$('#wallet-method').after(reference);}
    $('label',reference).textContent=manual.reference_label||'Funding reference';
    let destination=$('#manual-payment-details');
    if(!destination){destination=document.createElement('div');destination.id='manual-payment-details';destination.className='manual-payment-details';$('#wallet-method').after(destination);}
    $('#wallet-amount').value='';$('#wallet-amount').min='100';
    $('#wallet-form').dataset.key=key();delete $('#wallet-form').dataset.fingerprint;
    updateWalletMethod();openModal('wallet-modal');
    }finally{openingWallet=false;release();}
  }
  function showStripeCheckout(checkout,amount){
    const url=new URL(checkout.checkout_url);
    if(url.protocol!=='https:'||url.hostname!=='checkout.stripe.com'||url.username||url.password||url.port)throw new Error('Stripe returned an unsupported checkout address. Please contact support.');
    info('YOUR CARD. YOUR MOVE',`<div class="stripe-checkout-summary"><span class="payment-mode-tag">STRIPE ${esc(checkout.mode||paymentMethods.stripe?.mode||'')}</span><strong>${money(amount)}</strong><p>Continue to Stripe to enter your card details. Your wallet will update after Stripe confirms the payment.</p><small class="ledger-ref">${esc(checkout.reference)}</small></div><a class="button green wallet-submit" id="stripe-checkout-link" href="${esc(url.href)}">Continue to secure checkout ${icon('arrow')}</a><button class="auth-switch" data-wallet="deposit">Use another payment method</button>`);
  }
  function fundCopy(id){
    if(pendingForms.size||!requireUser())return;const s=getStrategy(id);if(!s)return;
    info('FUND YOUR COPY',`<p>${esc(s.name)} · ${Number(s.stake_percentage||2)}% per published pick. Your allocation is held separately from your wallet.</p><form id="server-copy-form" class="copy-funding-form" data-strategy="${s.id}" data-key="${key()}"><label for="server-copy-amount">Allocation amount (USD)</label><div class="amount-input"><span>$</span><input id="server-copy-amount" type="number" min="${Number(s.min_deposit_cents||10000)/100}" max="1000000" step=".01" required></div><div class="wallet-form-summary"><span>Available wallet balance</span><strong>${money(balance())}</strong></div><p class="form-error" id="server-copy-error" role="alert" hidden></p><button type="submit" class="button green wallet-submit">Allocate & copy ${icon('arrow')}</button></form><button class="auth-switch" data-wallet="deposit">Need funds? Add money to your wallet</button>`);
  }
  function navigate(next,hash=true){
    if(!['sports','live','games','copy','wallet','bets','admin','verification'].includes(next))next='sports';const changed=page!==next;page=next;
    $$('.page-panel').forEach(p=>p.hidden=p.id!==`${next==='live'?'sports':next}-page`);$$('.nav-link').forEach(b=>b.classList.toggle('active',b.dataset.page===next));
    if(next==='live'){liveOnly=true;$('#live-filter').classList.add('active');renderEvents();}
    $('#header-popover').hidden=true;$('#mobile-slip-button').hidden=!['sports','live'].includes(next);
    if(hash)history.pushState(null,'',`#${next}`);document.title=`${{sports:'Sports',live:'Live',games:'Games',copy:'Copy Staking',wallet:'Wallet',bets:'My stakes',admin:'Admin',verification:'Identity verification'}[next]} — EDGE`;
    if(changed)window.EdgeMotion?.transition?.(document.getElementById(`${next==='live'?'sports':next}-page`));
    window.scrollTo({top:0,behavior:'instant'});window.dispatchEvent(new CustomEvent('edge:navigate',{detail:{page:next}}));
  }
  async function submit(form,operation,errorSelector){
    const button=$('[type="submit"]',form);if(pendingForms.has(form.id)||button?.disabled)return;
    pendingForms.add(form.id);form.setAttribute('aria-busy','true');
    const release=busy(button,form.id==='auth-form'?(form.dataset.mode==='register'?'Creating account…':'Signing in…'):form.id==='wallet-form'?('Processing…'):'Submitting…');
    const controls=$$('input,select,button:not([type="submit"])',form).map(element=>({element,disabled:element.disabled}));controls.forEach(({element})=>element.disabled=true);
    const error=$(errorSelector);if(error)error.hidden=true;
    let succeeded=false;
    try{await operation();succeeded=true;}catch(e){const target=$(errorSelector);if(target){target.hidden=false;target.textContent=errors(e);}else toast(errors(e));if(e.status===419)toast('Your session token expired. Reload the page and try again.');}finally{pendingForms.delete(form.id);form.setAttribute('aria-busy','false');controls.forEach(({element,disabled})=>element.disabled=disabled);release();if(succeeded&&form.id==='server-stake-form')renderSlip();}
  }
  document.addEventListener('submit',e=>{
    const f=e.target;
    if(f.id==='auth-form'){e.preventDefault();submit(f,async()=>{const mode=f.dataset.mode;const payload={email:$('#auth-email').value,password:$('#auth-password').value};if(mode==='register'){payload.name=$('#auth-name').value;payload.password_confirmation=$('#auth-confirmation').value;}
      const challenge=await request(`/api/auth/${mode}`,{method:'POST',body:payload});showOtp(challenge);},'#auth-error');}
    if(f.id==='otp-form'){e.preventDefault();submit(f,async()=>{const session=await request('/api/auth/verify',{method:'POST',body:{code:$('#auth-code').value.trim()}});otpChallenge=null;clearInterval(otpTimer);user=session.user;await refresh();announceSession();closeModal(true);toast('Email verified. You’re signed in.');},'#otp-error');}
    if(f.id==='wallet-form'){e.preventDefault();submit(f,async()=>{
      const withdraw=walletMode==='withdraw',card=!withdraw&&$('#wallet-method').value==='stripe';
      const amount=cents($('#wallet-amount').value);
      if(!Number.isSafeInteger(amount)||amount<10000)throw new Error('Enter at least $100 with no more than two decimal places.');
      const chosen=selectedManualMethod(),methods=walletPaymentMethods||paymentMethods;
      const method=chosen?'manual:'+chosen.id:'bank_transfer';
      if(!card&&!chosen&&(methods.manual_catalog_configured||(!withdraw&&!methods.manual?.enabled)))throw new Error('Choose an available payment method.');
      const details=chosen?{method_version:chosen.version,...(withdraw?{answers:Object.fromEntries($$('[data-payment-field]',$('#manual-withdraw-fields')).map(input=>[input.dataset.paymentField,input.value.trim()]))}:{reference:$('#server-payment-reference').value})}:withdraw?{bank_name:$('#bank-name').value,account_name:$('#account-name').value,account_number:$('#account-number').value}:{reference:$('#server-payment-reference').value};
      const fingerprint=JSON.stringify({mode:walletMode,method:card?'stripe':method,amount,details:card?{}:details});
      if(f.dataset.fingerprint&&f.dataset.fingerprint!==fingerprint)f.dataset.key=key();f.dataset.fingerprint=fingerprint;
      if(card){
        const checkout=await request('/api/payments/stripe/checkout',{method:'POST',body:{amount_cents:amount,idempotency_key:f.dataset.key}});
        if(checkout.payment?.status==='paid'){await refresh();closeModal(true);navigate('wallet');toast('This card deposit is already confirmed in your wallet.');return;}
        showStripeCheckout(checkout,amount);return;
      }
      await request('/api/wallet/requests',{method:'POST',body:{type:withdraw?'withdrawal':'deposit',amount_cents:amount,method,details,idempotency_key:f.dataset.key}});
      await refresh();closeModal(true);navigate('wallet');toast('Your request was submitted for administrator review.');
    },'#wallet-error');}
    if(f.id==='server-copy-form'){e.preventDefault();submit(f,async()=>{await request('/api/copy/positions',{method:'POST',body:{strategy_id:Number(f.dataset.strategy),amount_cents:cents($('#server-copy-amount').value),idempotency_key:f.dataset.key}});await refresh();closeModal(true);toast('Your copy allocation is active.');},'#server-copy-error');}
    if(f.id==='server-stake-form'){e.preventDefault();if(!requireUser())return;submit(f,async()=>{
      if(betType==='multiple'&&selections.length<2)throw new Error('Select at least two different games for a multiple stake.');
      const payloads=betType==='multiple'?[selections]:selections.map(s=>[s]);
      const amount=cents($('#server-stake').value);if(!Number.isInteger(amount)||amount<100)throw new Error('The minimum stake is $1.');
      if(amount*payloads.length>balance())throw new Error('Your available wallet balance is too low.');
      for(let i=0;i<payloads.length;i++)await request('/api/bets',{method:'POST',body:{type:betType,stake_cents:amount,selections:payloads[i].map(({event_id,outcome,expected_odds,expected_version})=>({event_id,outcome,expected_odds,expected_version})),idempotency_key:`${f.dataset.key}-${i}`}});
      selections=[];stake='';betSubmissionKey=key();await refresh();toast('Your stake was accepted at the saved odds.');
    },'#server-slip-error');}
  });
  document.addEventListener('input',e=>{
    if(e.target.id==='server-stake'){if(cents(stake)!==cents(e.target.value))betSubmissionKey=key();stake=e.target.value;$('#server-stake-form').dataset.key=betSubmissionKey;const amount=Number(stake||0),multiple=betType==='multiple';$('#server-total-stake').textContent=money(cents(amount*(multiple?1:selections.length)));$('#server-potential').textContent=money(multiple?payout(cents(amount),selections):selections.reduce((n,s)=>n+payout(cents(amount),[s]),0));}
    if(e.target.id==='search-input'){query=e.target.value;renderEvents();}
  });
  document.addEventListener('pointerover',e=>{const point=e.target.closest('[data-copy-chart-point]');if(point)selectCopyChartPoint(point);});
  document.addEventListener('focusin',e=>{const point=e.target.closest('[data-copy-chart-point]');if(point)selectCopyChartPoint(point);});
  document.addEventListener('keydown',e=>{const point=e.target.closest('[data-copy-chart-point]');if(!point||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;const items=$$('[data-copy-chart-point]',point.closest('[data-copy-performance]')),index=items.indexOf(point),next=e.key==='Home'?0:e.key==='End'?items.length-1:Math.max(0,Math.min(items.length-1,index+(e.key==='ArrowLeft'?-1:1)));e.preventDefault();items[next].focus();selectCopyChartPoint(items[next]);});
  document.addEventListener('change',e=>{if(e.target.id==='wallet-method')updateWalletMethod();if(e.target.id==='transaction-filter')renderTransactions();if(e.target.id==='copy-risk-filter')renderCopy();});
  document.addEventListener('click',async e=>{
    const b=e.target.closest('button,a');if(!b)return;
    try{
      if(b.hasAttribute('data-copy-chart-point')){selectCopyChartPoint(b);return;}
      if(b.id==='refresh-card-payments'){if(!requireUser())return;await action(b,'Refreshing…',()=>refresh());return;}
      if(b.dataset.page){navigate(b.dataset.page);return;}
      if(b.matches('.brand')){if(b.getAttribute('href')==='/')return;e.preventDefault();navigate('sports');return;}
      if(b.id==='otp-resend'){if(pendingForms.size)return;await action(b,'Sending code…',async()=>{const challenge=await request('/api/auth/resend',{method:'POST',body:{}});showOtp(challenge);toast('A new code has been sent.');});return;}
      if(b.id==='otp-change'){if(pendingForms.size||pendingActions.has('otp-resend'))return;otpChallenge=null;clearInterval(otpTimer);auth();return;}
      if(b.dataset.auth){auth(b.dataset.auth);return;}
      if(b.dataset.wallet||b.dataset.modalWallet){await wallet(b.dataset.wallet||b.dataset.modalWallet,b);return;}
      if(b.hasAttribute('data-close-modal')){closeModal();return;}
      if(b.dataset.serverOdds){selectEvent(b.dataset.serverOdds,b.dataset.outcome);return;}
      if(b.dataset.serverRemove){selections=selections.filter(s=>String(s.event_id)!==b.dataset.serverRemove);betSubmissionKey=key();render();return;}
      if(b.dataset.betType){if(betType!==b.dataset.betType)betSubmissionKey=key();betType=b.dataset.betType;if(betType==='single')selections=selections.slice(0,1);renderEvents();renderSlip();return;}
      if(b.dataset.serverStake){stake=String(Number(stake||0)+Number(b.dataset.serverStake));betSubmissionKey=key();renderSlip();return;}
      if(b.dataset.amount){$('#wallet-amount').value=b.dataset.amount;return;}
      if(b.dataset.serverCopyFund){fundCopy(b.dataset.serverCopyFund);return;}
      if(b.dataset.serverCopyStatus){await action(b,'Updating…',async()=>{await request(`/api/copy/positions/${b.dataset.serverCopyStatus}`,{method:'PATCH',body:{status:b.dataset.status}});await refresh();},`copy-${b.dataset.serverCopyStatus}`);return;}
      if(b.dataset.serverCopyClose){const p=positions().find(p=>String(p.id)===b.dataset.serverCopyClose);info('RETURN TO WALLET',`<p>Close this position and return ${money(p.value_cents)} to your wallet. Positions with unsettled copied stakes must wait for final results.</p><button class="button green success-button" data-confirm-server-copy-close="${p.id}">Close position & return funds ${icon('arrow')}</button>`);return;}
      if(b.dataset.confirmServerCopyClose){await action(b,'Returning funds…',async()=>{await request(`/api/copy/positions/${b.dataset.confirmServerCopyClose}/close`,{method:'POST',body:{}});await refresh();closeModal(true);toast('Your copy position was closed and its funds returned.');},`copy-${b.dataset.confirmServerCopyClose}`);return;}
      if(b.dataset.copyPositionFilter){copyFilter=b.dataset.copyPositionFilter;$$('[data-copy-position-filter]').forEach(t=>t.classList.toggle('active',t===b));renderCopy();return;}
      if(b.dataset.sport){sport=b.dataset.sport;league='all';$$('[data-sport]').forEach(t=>{t.classList.toggle('active',t===b);t.setAttribute('aria-selected',String(t===b));});renderEvents();return;}
      if(b.dataset.league){league=b.dataset.league;$$('[data-league]').forEach(t=>t.classList.toggle('active',t===b));renderEvents();return;}
      if(b.dataset.betFilter){betFilter=b.dataset.betFilter;$$('[data-bet-filter]').forEach(t=>t.classList.toggle('active',t===b));renderBets();return;}
      if(b.id==='live-filter'){liveOnly=!liveOnly;b.classList.toggle('active',liveOnly);renderEvents();return;}
      if(b.id==='view-all-events'){expanded=!expanded;renderEvents();return;}
      if(b.id==='search-toggle'){$('#match-search').hidden=!$('#match-search').hidden;if(!$('#match-search').hidden)$('#search-input').focus();return;}
      if(b.id==='explore-button'){$('#markets-section').scrollIntoView({behavior:'smooth'});return;}
      if(b.id==='copy-explore'){$('#copy-strategies').scrollIntoView({behavior:'smooth'});return;}
      if(b.id==='server-clear-slip'){selections=[];stake='';betSubmissionKey=key();render();return;}
      if(b.id==='mobile-slip-button'){$('#betslip').classList.toggle('mobile-open');$('#betslip').scrollIntoView({behavior:'smooth'});return;}
      if(b.id==='profile-button'){if(!user){auth();return;}const p=$('#header-popover');p.hidden=!p.hidden;p.innerHTML=`<h3>Hey, ${esc(user.name.split(' ')[0])}.</h3><p>${esc(user.email)}</p><button data-page="wallet">Your wallet ↗</button><button data-page="verification">Identity verification ↗</button>${user.is_admin?'<button data-page="admin">Admin dashboard ↗</button>':''}<button id="server-logout">Sign out</button>`;return;}
      if(b.id==='server-logout'){await action(b,'Signing out…',async()=>{await request('/api/auth/logout',{method:'POST',body:{}});clearAccount();await refresh();navigate('sports');toast('You’re signed out.');});return;}
      if(b.id==='notifications-button'){const p=$('#header-popover');p.hidden=!p.hidden;p.innerHTML='<h3>Stay in the game.</h3><p>Wallet requests and stake results refresh automatically. Open your wallet or My bets to see their latest status.</p>';return;}
      if(b.dataset.info){info(b.dataset.info==='help'?'HOW IT WORKS':b.dataset.info==='terms'?'THE GROUND RULES':'PLAY IN CONTROL','<p>Games and odds are published by administrators. Accepted stakes retain their odds; final scores settle results and credit winning returns. Suspended, finished, void or closed games cannot accept new stakes.</p><p>Card deposits credit your wallet after Stripe payment confirmation. Manual deposits require administrator verification. Withdrawals reserve available wallet funds for review. This application does not initiate bank transfers.</p>');return;}
      if(b.dataset.serverGame){info('GAME PREVIEW','<p>This arcade title is not open for monetary staking. Available sports and their odds are managed from the administrator dashboard.</p>');return;}
    }catch(error){toast(errors(error));if(b.isConnected)b.disabled=false;}
  });
  document.addEventListener('click',e=>{if(e.target.classList.contains('modal-backdrop'))closeModal();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeModal();$('#header-popover').hidden=true;}if(e.key==='Tab'){const modal=$('.modal-backdrop:not([hidden])');if(!modal)return;const items=$$('button:not([disabled]),input:not([disabled]),select:not([disabled]),a[href]',modal).filter(e=>e.getClientRects().length);if(!items.length)return;if(e.shiftKey&&document.activeElement===items[0]){e.preventDefault();items.at(-1).focus();}else if(!e.shiftKey&&document.activeElement===items.at(-1)){e.preventDefault();items[0].focus();}}});
  window.addEventListener('popstate',()=>navigate(location.hash.slice(1)||'sports',false));
  window.addEventListener('edge:auth',()=>auth());
  window.addEventListener('edge:admin-refresh',()=>refresh().catch(e=>toast(errors(e))));
  window.addEventListener('edge:payment-settings-updated',()=>refresh().catch(e=>toast(errors(e))));
  window.addEventListener('edge:kyc-updated',()=>refresh().catch(e=>toast(errors(e))));
  window.addEventListener('edge:promo-redeemed',()=>refresh().catch(e=>toast(errors(e))));
  const games=[['Lucky Dice','dice-art','⚄'],['Crash','crash-art','↗'],['Hoop Shot','basket-art','◉']];
  const gameCards=games.map(([name,cls,symbol])=>`<button class="game-card" data-server-game="true"><div class="game-art ${cls}"><span class="game-label">PREVIEW</span><span class="server-game-symbol">${symbol}</span></div><div class="game-details"><div><h3>${name}</h3><p>Arcade preview · no monetary stakes</p></div>${icon('arrow')}</div></button>`).join('');
  $('#home-games').innerHTML=gameCards;$('#all-games').innerHTML=gameCards;
  $('.games-info span').textContent='Arcade previews. Monetary staking is available only for published sports events.';
  navigate(location.pathname==='/admin'?'admin':location.hash.slice(1)||'sports',false);
  render();
  (async()=>{
    let connected=false;
    try{const session=await request('/api/session');user=session.user;otpChallenge=session.auth_challenge;announceSession();await refresh();connected=true;if(!user&&otpChallenge)showOtp(otpChallenge);if(page==='admin')window.dispatchEvent(new CustomEvent('edge:navigate',{detail:{page:'admin'}}));}
    catch(e){toast(`Could not connect to the staking server. ${errors(e)}`);}
    finally{window.EdgeMotion?.ready?.();}
    const authMode=returnParameters.get('auth');
    if(['login','register'].includes(authMode)){
      const cleanURL=new URL(location.href);cleanURL.searchParams.delete('auth');history.replaceState(null,'',cleanURL.pathname+cleanURL.search+cleanURL.hash);
      if(!user&&connected)auth(authMode);
    }
  })();
  setInterval(()=>{if(!document.hidden)refresh().catch(()=>{});},20000);
})();
