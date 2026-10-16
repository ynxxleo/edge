(() => {
  'use strict';
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const money = n => new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 2 }).format(n);
  const shortMoney = n => `₦${Number(n).toLocaleString('en-NG', { maximumFractionDigits: 0 })}`;
  const escape = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const today = new Date();
  const dateAt = days => new Date(today.getTime() - days * 86400000).toISOString();
  const dateLabel = date => new Date(date).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const initial = () => ({
    balance: 124500, profit: 24500,
    bets: [
      { id: 'ED-10482', date: dateAt(0), title: 'Manchester City to win', match: 'Manchester City vs Real Madrid', market: 'Match winner', odds: 2.15, stake: 5000, returns: 10750, status: 'active' },
      { id: 'ED-10479', date: dateAt(0), title: 'Arsenal to win', match: 'Arsenal vs Chelsea', market: 'Match winner', odds: 3.1214285714, stake: 3500, returns: 10925, status: 'active' },
      { id: 'ED-10410', date: dateAt(2), title: 'Barcelona to win', match: 'Barcelona vs Sevilla', market: 'Match winner', odds: 2.4, stake: 5000, returns: 12000, status: 'won' }
    ],
    transactions: [
      { id: 'TX-10482', type: 'stake', title: 'Stake · Manchester City', amount: -5000, date: dateAt(0) },
      { id: 'TX-10479', type: 'stake', title: 'Stake · Arsenal', amount: -3500, date: dateAt(0) },
      { id: 'TX-10450', type: 'deposit', title: 'Deposit · Bank transfer', amount: 50000, date: dateAt(1) },
      { id: 'TX-10410', type: 'return', title: 'Winnings · Barcelona', amount: 12000, date: dateAt(2) },
      { id: 'TX-10380', type: 'withdrawal', title: 'Withdrawal · Bank transfer', amount: -20000, date: dateAt(3) },
      { id: 'TX-10360', type: 'deposit', title: 'Deposit · Debit card', amount: 100000, date: dateAt(5) }
    ]
  });
  let state;
  try { state = JSON.parse(localStorage.getItem('edge-demo-v1')); } catch (_) {}
  if (!state || !Number.isFinite(state.balance) || !Array.isArray(state.bets) || !Array.isArray(state.transactions)) state = initial();
  const save = () => { try { localStorage.setItem('edge-demo-v1', JSON.stringify(state)); } catch (_) { toast('Browser storage is unavailable. Changes will last for this visit.'); } };
  const fixtures = [
    { id:'ars-che', sport:'football', league:'Premier League', country:'England', a:'Arsenal', b:'Chelsea', ac:'ars', bc:'che', ai:'A', bi:'C', live:true, minute:"67′", score:[2,1], odds:[1.85,3.60,4.20], more:124 },
    { id:'mci-rma', sport:'football', league:'Champions League', country:'Europe', a:'Manchester City', b:'Real Madrid', ac:'mci', bc:'rma', ai:'MC', bi:'RM', live:false, time:'Today, 20:00', odds:[2.15,3.40,3.10], more:156 },
    { id:'bar-bay', sport:'football', league:'Champions League', country:'Europe', a:'Barcelona', b:'Bayern Munich', ac:'bar', bc:'bay', ai:'FCB', bi:'B', live:false, time:'Today, 20:00', odds:[2.40,3.50,2.80], more:142 },
    { id:'lal-bos', sport:'basketball', league:'NBA', country:'USA', a:'LA Lakers', b:'Boston Celtics', ac:'lal', bc:'bos', ai:'LA', bi:'B', live:true, minute:'Q3 · 06:24', score:[78,82], odds:[2.10,null,1.75], more:86 },
    { id:'atm-rso', sport:'football', league:'La Liga', country:'Spain', a:'Atlético Madrid', b:'Real Sociedad', ac:'ars', bc:'mci', ai:'AM', bi:'RS', live:false, time:'Tomorrow, 18:30', odds:[1.92,3.40,4.10], more:102 },
    { id:'sin-alc', sport:'tennis', league:'ATP Masters', country:'Shanghai', a:'Jannik Sinner', b:'Carlos Alcaraz', ac:'ten', bc:'ten', ai:'JS', bi:'CA', live:true, minute:'Set 2', score:[1,0], odds:[1.70,null,2.25], more:42 },
    { id:'ind-aus', sport:'cricket', league:'T20 International', country:'International', a:'India', b:'Australia', ac:'mci', bc:'ten', ai:'IN', bi:'AU', live:false, time:'Tomorrow, 13:00', odds:[1.80,null,2.05], more:54 },
    { id:'aj-dub', sport:'boxing', league:'Heavyweight', country:'London', a:'Anthony Joshua', b:'Daniel Dubois', ac:'ars', bc:'rma', ai:'AJ', bi:'DD', live:false, time:'Saturday, 22:00', odds:[2.30,18.00,1.65], more:30 },
    { id:'g2-navi', sport:'esports', league:'Counter-Strike 2', country:'ESL', a:'G2 Esports', b:'Natus Vincere', ac:'rma', bc:'lal', ai:'G2', bi:'NV', live:true, minute:'Map 2', score:[1,0], odds:[1.65,null,2.30], more:38 }
  ];
  let page='sports', sport='all', league='all', liveOnly=false, query='', expanded=false, selections=[], betType='single', stakeAmount='', betFilter='active', walletMode='deposit', modalTrigger=null, toastTimer;
  const diceSvg = `<svg viewBox="0 0 140 140" aria-hidden="true"><g transform="rotate(-18 53 70)"><rect x="17" y="32" width="67" height="67" rx="13" fill="#fcfff9"/><path d="m24 94 8 10h51l8-11V45l-8-8v49a8 8 0 0 1-8 8Z" fill="#c9d9bf"/><g fill="#244a36"><circle cx="34" cy="48" r="5"/><circle cx="67" cy="48" r="5"/><circle cx="51" cy="65" r="5"/><circle cx="34" cy="82" r="5"/><circle cx="67" cy="82" r="5"/></g></g><g transform="rotate(15 98 88)"><rect x="70" y="63" width="53" height="53" rx="11" fill="#193e2c"/><path d="m74 111 6 8h44l5-8V74l-6-7v38a6 6 0 0 1-6 6Z" fill="#0d2b1c"/><g fill="#9de5be"><circle cx="84" cy="77" r="4"/><circle cx="110" cy="103" r="4"/><circle cx="97" cy="90" r="4"/></g></g></svg>`;
  const rocketSvg = `<svg viewBox="0 0 150 150" aria-hidden="true"><path d="M21 117C49 113 54 92 75 85s31-27 55-57" stroke="#aba1bc" stroke-width="1" fill="none" stroke-dasharray="3 5"/><path d="m44 108-14 21 24-12 13-22Z" fill="#bba1d1"/><g transform="rotate(39 83 68)"><path d="M71 84 55 105V78l16-15Z" fill="#5f4778"/><path d="m94 84 16 21V78L94 63Z" fill="#5f4778"/><path d="M71 88V55c0-17 11-33 12-33s11 16 11 33v33Z" fill="#faf8ff"/><path d="M83 22c1 0 11 16 11 33v33H83Z" fill="#d4c8df"/><circle cx="83" cy="57" r="8" fill="#51456b"/><circle cx="83" cy="57" r="5" fill="#ada5cf"/><path d="M75 90h15l-5 22-3 7-4-7Z" fill="#c7a1ed"/><path d="M79 91h7l-3 16Z" fill="#fff"/></g></svg>`;
  const games = [
    {id:'dice',title:'Lucky Dice',description:'A little luck. A bold move.',label:'POPULAR',art:`<div class="game-art dice-art"><span class="game-label">POPULAR</span><span class="game-orbit"></span>${diceSvg}</div>`},
    {id:'crash',title:'Crash',description:'How high will you go?',label:'QUICK PLAY',art:`<div class="game-art crash-art"><span class="game-label">QUICK PLAY</span><span class="game-orbit"></span>${rocketSvg}</div>`},
    {id:'hoops',title:'Hoop Shot',description:'Find your rhythm. Take the shot.',label:'FAN FAVORITE',art:'<div class="game-art basket-art"><span class="game-label">FAN FAVORITE</span><img src="/assets/game-basketball.jpg" alt="Basketball hoop under stadium lights" loading="lazy"><span class="game-art-word">HOOP<br>SHOT.</span></div>'}
  ];
  const gameCard = g => `<button class="game-card" data-game="${g.id}">${g.art}<div class="game-details"><div><h3>${g.title}</h3><p>${g.description}</p></div>${icon('arrow')}</div></button>`;
  $('#home-games').innerHTML = games.map(gameCard).join('');
  $('#all-games').innerHTML = games.map(gameCard).join('');

  function renderWallet() {
    $$('[data-balance]').forEach(el => {
      if (el.classList.contains('wallet-balance')) { const [whole, decimal] = money(state.balance).split('.'); el.innerHTML=`${whole}<span>.${decimal}</span>`; }
      else el.textContent=money(state.balance);
    });
    $$('[data-profit]').forEach(el=>el.textContent=money(state.profit));
    const active=state.bets.filter(b=>b.status==='active');
    $$('[data-stakes]').forEach(el=>el.textContent=money(active.reduce((n,b)=>n+b.stake,0)));
    $$('[data-returns]').forEach(el=>el.textContent=money(active.reduce((n,b)=>n+b.returns,0)));
    $('#bets-count').textContent=active.length;
    $('#active-bet-count').textContent=active.length;
    renderTransactions(); renderBets();
  }
  function renderMatches() {
    const filtered=fixtures.filter(f=>(sport==='all'||f.sport===sport)&&(league==='all'||f.league===league)&&(!liveOnly||f.live)&&(!query||`${f.a} ${f.b} ${f.league}`.toLowerCase().includes(query.toLowerCase())));
    const visible=expanded?filtered:filtered.slice(0,4);
    $('#view-all-events').hidden=filtered.length<=4;
    $('#view-all-events').innerHTML=`${expanded?'Show fewer events':'View all events'} <span id="event-total">(${filtered.length})</span> ${icon('arrow')}`;
    $('#match-list').innerHTML=visible.length?visible.map(f=>`<article class="match-card"><div class="match-meta">${icon(f.sport==='esports'?'game':f.sport)}<span>${escape(f.country)}</span><span> / </span><span>${escape(f.league)}</span>${f.live?`<span class="live-tag">LIVE &nbsp; ${escape(f.minute)}</span>`:`<span class="match-time">${escape(f.time)}</span>`}</div><div class="match-main"><div class="match-teams"><div class="team-row"><span class="team-crest ${f.ac}">${f.ai}</span><span>${escape(f.a)}</span></div><div class="team-row"><span class="team-crest ${f.bc}">${f.bi}</span><span>${escape(f.b)}</span></div></div><div class="score-column ${f.live?'':'muted'}"><span>${f.live?f.score[0]:'–'}</span><span>${f.live?f.score[1]:'–'}</span></div><div class="odds-group">${f.odds.map((o,i)=>`<button class="odds-button ${selections.some(s=>s.matchId===f.id&&s.outcome===i)?'selected':''}" data-odds="${f.id}" data-outcome="${i}" ${o===null?'disabled':''} aria-label="${escape(i===0?f.a:i===2?f.b:'Draw')} at odds ${o||'unavailable'}" aria-pressed="${selections.some(s=>s.matchId===f.id&&s.outcome===i)}"><span>${i===0?'1':i===1?'X':'2'}</span><strong>${o===null?'—':o.toFixed(2)}</strong></button>`).join('')}</div><button class="match-more" data-event="${f.id}" aria-label="View ${escape(f.a)} versus ${escape(f.b)} details">+${f.more} ›</button></div></article>`).join(''):`<div class="empty-events">${icon('search')}<h3>No events match your filters</h3><p>Try another sport or competition, or turn off the live filter.</p><button class="button outline" data-reset-filters>Reset filters</button></div>`;
    const labels={all:'Live & upcoming',football:'Football',basketball:'Basketball',tennis:'Tennis',cricket:'Cricket',boxing:'Boxing',esports:'Esports'};
    $('#market-title').innerHTML=`${liveOnly?'Live ':''}${liveOnly&&sport==='all'?'events':labels[sport]}<span class="green-text">.</span>`;
  }
  function slipTotals() {
    const stake=Number(stakeAmount)||0;
    const odds=selections.reduce((n,s)=>n*s.odds,1);
    return {stake,odds,totalStake:betType==='single'?stake*selections.length:stake,returns:betType==='single'?selections.reduce((n,s)=>n+stake*s.odds,0):stake*odds};
  }
  function renderSlip() {
    $('#slip-count').textContent=selections.length;
    $('#mobile-slip-count').textContent=selections.length;
    $$('[data-bet-type]').forEach(b=>b.classList.toggle('active',b.dataset.betType===betType));
    if(!selections.length){$('#slip-content').innerHTML=`<div class="empty-slip"><div class="empty-slip-icon">${icon('wallet')}<span>+</span></div><h4>Your next move starts here.</h4><p>Pick an outcome to add it to your slip.<br>The game is yours to call.</p></div>`;return;}
    const t=slipTotals();
    $('#slip-content').innerHTML=`<div class="slip-selections">${selections.map(s=>`<div class="slip-selection"><button class="remove-selection" data-remove="${s.matchId}" aria-label="Remove ${escape(s.title)}">${icon('close')}</button><h4>${escape(s.title)}</h4><p>${escape(s.match)}</p><div class="selection-market"><span>Match winner</span><strong>${s.odds.toFixed(2)}</strong></div></div>`).join('')}</div><form class="stake-form" id="stake-form"><label for="stake-amount">${betType==='single'&&selections.length>1?'Stake per selection':'Stake amount'} <span>NGN</span></label><div class="stake-input"><span>₦</span><input id="stake-amount" type="number" min="100" max="1000000" step="0.01" placeholder="0.00" value="${escape(stakeAmount)}" required inputmode="decimal"></div><div class="stake-presets"><button type="button" data-stake="500">+500</button><button type="button" data-stake="1000">+1,000</button><button type="button" data-stake="5000">+5,000</button></div>${betType==='multiple'?`<div class="slip-summary"><span>Combined odds</span><strong id="slip-odds">${t.odds.toFixed(2)}</strong></div>`:''}<div class="slip-summary"><span>Total stake</span><strong id="slip-total-stake">${money(t.totalStake)}</strong></div><div class="slip-summary return-row"><span>Potential return</span><strong id="slip-potential-return">${money(t.returns)}</strong></div><p class="slip-error" id="slip-error" role="alert" hidden></p><button class="button green stake-submit" type="submit">Place demo stake ${icon('arrow')}</button><button type="button" class="clear-slip" id="clear-slip">Clear bet slip</button></form>`;
  }
  function addSelection(id,outcome) {
    const f=fixtures.find(f=>f.id===id); if(!f||!f.odds[outcome])return;
    const existing=selections.find(s=>s.matchId===id);
    if(existing&&existing.outcome===outcome) selections=selections.filter(s=>s.matchId!==id);
    else {
      const title=outcome===0?`${f.a} to win`:outcome===2?`${f.b} to win`:'Draw';
      selections=selections.filter(s=>s.matchId!==id);
      selections.push({matchId:id,outcome,title,match:`${f.a} vs ${f.b}`,odds:f.odds[outcome]});
      toast(`${title} added to your bet slip.`);
    }
    renderMatches();renderSlip();
  }
  function renderTransactions() {
    const filter=$('#transaction-filter').value;
    const txs=state.transactions.filter(t=>filter==='all'||t.type===filter);
    $('#transaction-body').innerHTML=txs.length?txs.map(t=>`<tr><td><span class="transaction-name"><span class="transaction-icon">${icon(t.type==='deposit'?'plus':t.type==='withdrawal'?'arrow':t.type==='return'?'trophy':'football')}</span>${escape(t.title)}</span></td><td>${dateLabel(t.date)}</td><td class="${t.amount>0?'amount-positive':'amount-negative'}">${t.amount>0?'+':'−'}${money(Math.abs(t.amount))}</td><td><span class="transaction-status">Completed · Demo</span></td></tr>`).join(''):'<tr><td colspan="4">No transactions in this category yet.</td></tr>';
  }
  function renderBets() {
    const bets=state.bets.filter(b=>betFilter==='all'||(betFilter==='active'?b.status==='active':b.status!=='active'));
    $('#bet-history').innerHTML=bets.length?bets.map(b=>`<article class="history-card"><div class="history-top"><span>${escape(b.id)} · ${dateLabel(b.date)}</span><span class="history-status">${b.status==='active'?'ACTIVE':b.status==='won'?'WON':'CASHED OUT'}</span></div><h3>${escape(b.title)}</h3><p>${escape(b.match)}<br>${escape(b.market)} · ${b.odds.toFixed(2)}</p><div class="history-values"><div><span>STAKE</span><strong>${money(b.stake)}</strong></div><div><span>${b.status==='cashed'?'CASH OUT RETURN':b.status==='won'?'TOTAL RETURN':'POTENTIAL RETURN'}</span><strong class="green-text">${money(b.returns)}</strong></div></div>${b.status==='active'?`<button class="cashout-button" data-cashout="${escape(b.id)}">Cash out · ${money(Math.round(b.stake*1.08*100)/100)}</button>`:''}</article>`).join(''):'<div class="empty-history">No bets here yet. Explore the sports markets and add an outcome to your bet slip.</div>';
  }
  function navigate(next,updateHash=true) {
    if(!['sports','live','games','wallet','bets'].includes(next))next='sports';
    page=next;
    $$('.page-panel').forEach(p=>p.hidden=p.id!==`${next==='live'?'sports':next}-page`);
    $$('.nav-link').forEach(b=>b.classList.toggle('active',b.dataset.page===next));
    $('#header-popover').hidden=true;
    $('#mobile-slip-button').hidden=!['sports','live'].includes(next);
    if(next==='live'){liveOnly=true;$('#live-filter').classList.add('active');renderMatches();}
    else if(next==='sports'){liveOnly=false;$('#live-filter').classList.remove('active');renderMatches();}
    if(updateHash && location.hash!==`#${next}`)history.pushState(null,'',`#${next}`);
    document.title=`${next==='wallet'?'Wallet':next==='bets'?'My bets':next==='games'?'Games':'Sports'} — EDGE`;
    window.scrollTo({top:0,behavior:'instant'});
  }
  function toast(message) { clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,4000); }
  function openModal(id,trigger=document.activeElement) {
    modalTrigger=trigger;
    $$('.modal-backdrop').forEach(m=>m.hidden=m.id!==id);
    document.body.style.overflow='hidden';
    const first=$('button,input,select',document.getElementById(id));if(first)first.focus();
  }
  function closeModal() { $$('.modal-backdrop').forEach(m=>m.hidden=true);document.body.style.overflow='';if(modalTrigger&&modalTrigger.isConnected)modalTrigger.focus(); }
  function openWallet(mode) {
    walletMode=mode; const withdraw=mode==='withdraw';
    $('#wallet-modal-title').innerHTML=withdraw?'MAKE A WITHDRAWAL<span>.</span>':'MAKE A DEPOSIT<span>.</span>';
    $('#wallet-modal-description').textContent=withdraw?'Withdraw your available demo stake and profits.':'Add demo funds and get ready for your next move.';
    $$('[data-modal-wallet]').forEach(b=>b.classList.toggle('active',b.dataset.modalWallet===mode));
    $('#wallet-method-label').hidden=withdraw;$('#wallet-method').hidden=withdraw;
    $('#withdraw-fields').hidden=!withdraw;
    ['bank-name','account-number','account-name'].forEach(id=>{const field=document.getElementById(id);field.required=withdraw;field.disabled=!withdraw;});
    $('#wallet-submit').innerHTML=`${withdraw?'Withdraw demo funds':'Add demo funds'} ${icon('arrow')}`;
    $('#wallet-error').hidden=true;
    $('#wallet-amount').value='';
    $('#wallet-amount').max=withdraw?state.balance:1000000;
    openModal('wallet-modal');
  }
  function showSuccess(title,description,amount,details=[]) {
    $('#info-content').innerHTML=`<div class="success-symbol">${icon('check')}</div><span class="section-kicker">MOVE COMPLETE / EDGE</span><h2 id="info-title">${title}<span>.</span></h2><p>${description}</p><div class="success-amount">${money(amount)}</div><div class="success-details">${details.map(([k,v])=>`<div><span>${escape(k)}</span><strong>${escape(v)}</strong></div>`).join('')}<div><span>Available balance</span><strong>${money(state.balance)}</strong></div></div><button class="button green success-button" data-close-modal>Back to the game ${icon('arrow')}</button>`;
    openModal('info-modal');
  }
  function showInfo(kind) {
    const content={
      responsible:{title:'STAY IN CONTROL',body:'<p>Enjoy the game at your own pace. Set a budget before you play, take regular breaks, and never stake more than you can afford to lose.</p><ul><li>This experience is for adults aged 18 and above.</li><li>Odds and events in this demo are sample data.</li><li>Returns are potential outcomes, never a guarantee.</li></ul><p>This demo uses virtual funds. No real money is accepted.</p>'},
      help:{title:'HOW CAN WE HELP?',body:'<p><strong>Build your slip</strong><br>Select an outcome in a sports market, enter a demo stake, and place your bet.</p><p><strong>Manage your wallet</strong><br>Add demo funds with Deposit. Withdraw from the available balance, including profits, using sample bank details.</p><p><strong>Track your plays</strong><br>Open My bets to see active and settled stakes. Cash out an active demo stake to move its return into your available balance.</p>'},
      terms:{title:'THE GROUND RULES',body:'<p>EDGE is an interactive UI demonstration. All fixtures, odds, balances, transactions and cash-out values are illustrative.</p><p>Funds are virtual and stored locally in your browser. There are no connected payment processors, real bets, bank transfers or live event feeds.</p><p>The arcade uses free rounds and does not deduct money. Deposits and withdrawals demonstrate the product flow only.</p>'},
      account:{title:'YOUR ACCOUNT',body:'<p><strong>Jordan Adams</strong><br>Demo member · NGN wallet</p><p>Your wallet activity and stakes are saved in this browser. No account registration is needed for this preview.</p><button class="button outline" id="reset-demo">Reset demo wallet</button>'}
    };
    const c=content[kind];if(!c)return;
    $('#info-content').innerHTML=`<span class="section-kicker">THE EDGE EXPERIENCE</span><h2 id="info-title">${c.title}<span>.</span></h2>${c.body}`;openModal('info-modal');
  }
  function openGame(id) {
    const g=games.find(g=>g.id===id);if(!g)return;
    $('#info-content').innerHTML=`<span class="section-kicker">EDGE ARCADE / FREE PLAY</span><h2 id="info-title">${g.title.toUpperCase()}<span>.</span></h2><p>${id==='dice'?'Roll the dice. A double is a win.':id==='crash'?'Launch a free round and see how high you fly.':'Step up to the line and take your shot.'} No wallet funds are used.</p><div class="mini-game"><div class="${id==='dice'?'dice-result':id==='crash'?'crash-number':'hoop-result'}" id="arcade-display">${id==='dice'?'⚄ ⚂':id==='crash'?'1.00×':'◉'}</div><p id="arcade-result">Ready when you are.</p><button class="button green" data-play="${id}">${id==='dice'?'Roll the dice':id==='crash'?'Launch round':'Take the shot'} ${icon('arrow')}</button></div><p class="modal-fine-print">Free play · No stakes or cash prizes</p>`;openModal('info-modal');
  }
  document.addEventListener('click',e=>{
    const b=e.target.closest('button,a');
    if(b?.dataset.page){navigate(b.dataset.page);return;}
    if(b?.matches('.brand')){e.preventDefault();navigate('sports');return;}
    if(b?.dataset.wallet){openWallet(b.dataset.wallet);return;}
    if(b?.dataset.modalWallet){openWallet(b.dataset.modalWallet);return;}
    if(b?.hasAttribute('data-close-modal')){closeModal();return;}
    if(e.target.classList.contains('modal-backdrop')){closeModal();return;}
    if(b?.dataset.sport){sport=b.dataset.sport;league='all';expanded=false;$$('[data-sport]').forEach(t=>{const active=t.dataset.sport===sport;t.classList.toggle('active',active);t.setAttribute('aria-selected',String(active));});$$('[data-league]').forEach(t=>t.classList.toggle('active',t.dataset.league==='all'));renderMatches();return;}
    if(b?.dataset.league){league=b.dataset.league;expanded=false;$$('[data-league]').forEach(t=>t.classList.toggle('active',t.dataset.league===league));renderMatches();return;}
    if(b?.dataset.odds){addSelection(b.dataset.odds,Number(b.dataset.outcome));return;}
    if(b?.dataset.remove){selections=selections.filter(s=>s.matchId!==b.dataset.remove);renderMatches();renderSlip();return;}
    if(b?.dataset.betType){betType=b.dataset.betType;renderSlip();return;}
    if(b?.dataset.stake){stakeAmount=String((Number(stakeAmount)||0)+Number(b.dataset.stake));renderSlip();return;}
    if(b?.dataset.amount){$('#wallet-amount').value=b.dataset.amount;return;}
    if(b?.dataset.info){showInfo(b.dataset.info);return;}
    if(b?.dataset.game){openGame(b.dataset.game);return;}
    if(b?.dataset.play){
      const id=b.dataset.play;
      if(id==='dice'){const a=Math.ceil(Math.random()*6),c=Math.ceil(Math.random()*6);$('#arcade-display').textContent=`${['⚀','⚁','⚂','⚃','⚄','⚅'][a-1]} ${['⚀','⚁','⚂','⚃','⚄','⚅'][c-1]}`;$('#arcade-result').textContent=a===c?'Double! That’s a winning roll.':`You rolled ${a+c}. Give it another shot.`;}
      else if(id==='crash'){const x=(1+Math.random()*7).toFixed(2);$('#arcade-display').textContent=`${x}×`;$('#arcade-result').textContent=`Round ended at ${x}×. Ready for another flight?`;}
      else {const scored=Math.random()>.4;$('#arcade-display').textContent=scored?'◎':'◌';$('#arcade-result').textContent=scored?'Nothing but net. Nice shot!':'Off the rim. Line up your next shot.';}
      $('#arcade-result').classList.add('game-result');return;
    }
    if(b?.dataset.betFilter){betFilter=b.dataset.betFilter;$$('[data-bet-filter]').forEach(t=>t.classList.toggle('active',t.dataset.betFilter===betFilter));renderBets();return;}
    if(b?.dataset.cashout){
      const bet=state.bets.find(x=>x.id===b.dataset.cashout&&x.status==='active');if(!bet)return;
      const amount=Math.round(bet.stake*1.08*100)/100;
      $('#info-content').innerHTML=`<span class="section-kicker">YOUR NEXT MOVE</span><h2 id="info-title">CASH OUT<span>?</span></h2><p>Settle <strong>${escape(bet.title)}</strong> now and move the demo return to your available wallet balance.</p><div class="success-amount">${money(amount)}</div><p>This closes your stake. The potential return of ${money(bet.returns)} will no longer apply.</p><button class="button green success-button" data-confirm-cashout="${escape(bet.id)}">Confirm demo cash out ${icon('arrow')}</button>`;openModal('info-modal');return;
    }
    if(b?.dataset.confirmCashout){const bet=state.bets.find(x=>x.id===b.dataset.confirmCashout&&x.status==='active');if(!bet)return;const amount=Math.round(bet.stake*1.08*100)/100;bet.status='cashed';bet.returns=amount;state.balance=Math.round((state.balance+amount)*100)/100;state.profit=Math.round((state.profit+amount-bet.stake)*100)/100;state.transactions.unshift({id:`TX-${Date.now()}`,type:'return',title:`Cash out · ${bet.title}`,amount,date:new Date().toISOString()});save();renderWallet();showSuccess('CASH OUT COMPLETE','Your demo return is available in your wallet.',amount,[['Stake reference',bet.id],['Profit',money(amount-bet.stake)]]);return;}
    if(b?.dataset.event){const f=fixtures.find(x=>x.id===b.dataset.event);$('#info-content').innerHTML=`<span class="section-kicker">${escape(f.league.toUpperCase())} / MATCH CENTER</span><h2 id="info-title">${escape(f.a.toUpperCase())}<br>VS ${escape(f.b.toUpperCase())}<span>.</span></h2><p>${f.live?`Sample live score: ${f.score[0]} – ${f.score[1]} · ${escape(f.minute)}`:escape(f.time)}</p><p>Match winner · Select your outcome below to add it to your bet slip.</p><div class="odds-group">${f.odds.map((o,i)=>o===null?'':`<button class="odds-button" data-modal-odds="${f.id}" data-outcome="${i}"><span>${escape(i===0?f.a:i===2?f.b:'Draw')}</span><strong>${o.toFixed(2)}</strong></button>`).join('')}</div><p class="modal-fine-print">Sample fixture and odds for demonstration.</p>`;openModal('info-modal');return;}
    if(b?.dataset.modalOdds){addSelection(b.dataset.modalOdds,Number(b.dataset.outcome));closeModal();return;}
    if(b?.hasAttribute('data-reset-filters')){sport='all';league='all';liveOnly=false;query='';$('#search-input').value='';$('#live-filter').classList.remove('active');$$('[data-sport]').forEach(t=>{const a=t.dataset.sport==='all';t.classList.toggle('active',a);t.setAttribute('aria-selected',String(a));});$$('[data-league]').forEach(t=>t.classList.toggle('active',t.dataset.league==='all'));renderMatches();return;}
    if(b?.id==='live-filter'){liveOnly=!liveOnly;b.classList.toggle('active',liveOnly);renderMatches();return;}
    if(b?.id==='search-toggle'){const field=$('#match-search');field.hidden=!field.hidden;if(!field.hidden)$('#search-input').focus();return;}
    if(b?.id==='view-all-events'){expanded=!expanded;renderMatches();return;}
    if(b?.id==='explore-button'){$('#markets-section').scrollIntoView({behavior:'smooth'});return;}
    if(b?.id==='clear-slip'){selections=[];stakeAmount='';renderMatches();renderSlip();return;}
    if(b?.id==='mobile-slip-button'){const slip=$('#betslip');slip.classList.toggle('mobile-open');if(slip.classList.contains('mobile-open'))slip.scrollIntoView({behavior:'smooth',block:'center'});return;}
    if(b?.id==='notifications-button'){const p=$('#header-popover');const visible=!p.hidden&&p.dataset.kind==='notifications';p.hidden=visible;p.dataset.kind='notifications';p.innerHTML='<h3>You’re all caught up.</h3><p>Stake updates and wallet notifications will appear here. Your demo wallet is ready to explore.</p>';return;}
    if(b?.id==='profile-button'){const p=$('#header-popover');const visible=!p.hidden&&p.dataset.kind==='profile';p.hidden=visible;p.dataset.kind='profile';p.innerHTML='<h3>Hey, Jordan.</h3><p>Make yourself at home.</p><button data-info="account">Your account ↗</button><button data-page="wallet">Your wallet ↗</button><button data-info="responsible">Responsible play ↗</button>';return;}
    if(b?.id==='reset-demo'){state=initial();selections=[];stakeAmount='';save();renderWallet();renderSlip();renderMatches();closeModal();toast('Your demo wallet has been reset.');return;}
    if(!e.target.closest('#header-popover'))$('#header-popover').hidden=true;
  });
  document.addEventListener('input',e=>{
    if(e.target.id==='search-input'){query=e.target.value;renderMatches();}
    if(e.target.id==='stake-amount'){stakeAmount=e.target.value;const t=slipTotals();$('#slip-total-stake').textContent=money(t.totalStake);$('#slip-potential-return').textContent=money(t.returns);$('#slip-error').hidden=true;}
  });
  $('#transaction-filter').addEventListener('change',renderTransactions);
  document.addEventListener('submit',e=>{
    if(e.target.id==='wallet-form'){
      e.preventDefault();
      const amount=Number($('#wallet-amount').value),fail=message=>{$('#wallet-error').textContent=message;$('#wallet-error').hidden=false;};
      if(!Number.isFinite(amount)||amount<100||Math.round(amount*100)!==amount*100&&Math.abs(Math.round(amount*100)-amount*100)>0.00001)return fail('Enter an amount of at least ₦100 with no more than two decimal places.');
      if(amount>1000000)return fail('The demo transaction limit is ₦1,000,000.');
      if(walletMode==='withdraw'&&amount>state.balance)return fail('This amount exceeds your available balance. Active stakes must be cashed out first.');
      if(walletMode==='withdraw'&&(!$('#bank-name').value||!/^\d{10}$/.test($('#account-number').value)||$('#account-name').value.trim().length<2))return fail('Select a bank and enter a 10-digit account number and account holder name.');
      const withdraw=walletMode==='withdraw',method=withdraw?'Bank transfer':$('#wallet-method').value==='card'?'Debit card':'Bank transfer';
      const reference=`TX-${Date.now().toString().slice(-9)}`;
      state.balance=Math.round((state.balance+(withdraw?-amount:amount))*100)/100;
      state.transactions.unshift({id:reference,type:withdraw?'withdrawal':'deposit',title:`${withdraw?'Withdrawal':'Deposit'} · ${method}`,amount:withdraw?-amount:amount,date:new Date().toISOString()});
      save();renderWallet();
      const details=[['Reference',reference],['Method',`${method} · Demo`]];
      if(withdraw)details.push(['Account',`${$('#bank-name').value} •••• ${$('#account-number').value.slice(-4)}`]);
      showSuccess(withdraw?'WITHDRAWAL COMPLETE':'YOU’RE FUNDED',withdraw?'Your demo withdrawal is complete. No real bank transfer was made.':'Your demo funds are ready for your next move.',amount,details);
      $('#wallet-form').reset();
    }
    if(e.target.id==='stake-form'){
      e.preventDefault();const t=slipTotals();
      const fail=m=>{$('#slip-error').textContent=m;$('#slip-error').hidden=false;};
      if(!selections.length)return;
      if(!Number.isFinite(t.stake)||t.stake<100||Math.abs(t.stake*100-Math.round(t.stake*100))>.00001)return fail('Enter a stake of at least ₦100, with at most two decimal places.');
      if(t.totalStake>1000000)return fail('The maximum total demo stake is ₦1,000,000.');
      if(t.totalStake>state.balance)return fail('Your available balance is too low. Add demo funds or lower your stake.');
      const now=new Date().toISOString(),ref=`ED-${Date.now().toString().slice(-8)}`;
      const newBets=betType==='single'?selections.map((s,i)=>({id:`${ref}-${i+1}`,date:now,title:s.title,match:s.match,market:'Match winner',odds:s.odds,stake:t.stake,returns:Math.round(t.stake*s.odds*100)/100,status:'active'})):[{id:ref,date:now,title:`${selections.length}-selection accumulator`,match:selections.map(s=>s.title).join(' · '),market:'Multiple · Match winner',odds:t.odds,stake:t.stake,returns:Math.round(t.returns*100)/100,status:'active'}];
      state.balance=Math.round((state.balance-t.totalStake)*100)/100;state.bets.unshift(...newBets);state.transactions.unshift({id:ref,type:'stake',title:`Stake · ${newBets.length===1?newBets[0].title:`${newBets.length} singles`}`,amount:-t.totalStake,date:now});save();renderWallet();
      selections=[];stakeAmount='';renderMatches();renderSlip();showSuccess('YOU’RE IN THE GAME','Your demo stake is placed. Track it in My bets, or cash out to release the return.',t.totalStake,[['Reference',ref],['Potential return',money(t.returns)]]);
    }
  });
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){closeModal();$('#header-popover').hidden=true;}
    if(e.key==='Tab'){
      const modal=$('.modal-backdrop:not([hidden])');if(!modal)return;
      const focusable=$$('button:not([disabled]),input:not([disabled]),select:not([disabled]),a[href]',modal).filter(el=>el.getClientRects().length);
      const first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
    }
  });
  window.addEventListener('popstate',()=>navigate(location.hash.slice(1)||'sports',false));
  renderWallet();renderMatches();renderSlip();navigate(location.hash.slice(1)||'sports',false);
})();
