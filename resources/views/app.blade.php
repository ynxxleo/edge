<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#111310">
  <meta name="description" content="Your game. Your edge. Explore sports and games, build a bet slip and manage your demo wallet.">
  <title>EDGE — Your game. Your edge.</title>
  <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/assets/app.css">
  <link rel="stylesheet" href="/assets/admin.css">
  <link rel="stylesheet" href="/assets/server.css">
  <link rel="stylesheet" href="/assets/motion.css">
  <link rel="stylesheet" href="/assets/kyc.css">
  <link rel="stylesheet" href="/assets/support.css">
  <link rel="stylesheet" href="/assets/promo.css">
  <link rel="stylesheet" href="/assets/manual-methods.css">
  <script src="/assets/motion.js" defer></script>
  <script src="/assets/app.js" defer></script>
  <script src="/assets/server-app.js" defer></script>
  <script src="/assets/admin.js" defer></script>
  <script src="/assets/kyc.js" defer></script>
  <script src="/assets/support.js" defer></script>
  <script src="/assets/promo.js" defer></script>
  <script src="/assets/manual-methods.js" defer></script>
</head>
<body data-runtime="{{ $serverMode ?? 'static' }}" data-edge-preload="app">
  <div id="edge-page-loader" class="edge-page-loader" role="status" aria-live="polite" aria-hidden="true" hidden>
    <div class="edge-loader-mark" aria-hidden="true">EDGE<span>✳</span></div>
    <span class="edge-loader-caption">Loading your edge</span>
    <div class="edge-loader-track" aria-hidden="true"><i></i><i></i><i></i></div>
  </div>
  <svg class="icon-definitions" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs>
    <symbol id="i-arrow" viewBox="0 0 24 24"><path d="M5 19 19 5M5 5h14v14"/></symbol>
    <symbol id="i-chevron" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></symbol>
    <symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>
    <symbol id="i-wallet" viewBox="0 0 24 24"><path d="M20 8V5H5a2 2 0 0 0 0 4h16v11H5a2 2 0 0 1-2-2V7m18 5h-5v5h5"/><path d="M17.5 14.5h.1"/></symbol>
    <symbol id="i-football" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m12 7 5 3-2 5H9l-2-5 5-3Zm0-4v4m9 5-4-2m.5 9L15 15m-8.5 4L9 15M3 12l4-2"/></symbol>
    <symbol id="i-basketball" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3v18M5.5 5.5c7 3 7 10 0 13m13-13c-7 3-7 10 0 13"/></symbol>
    <symbol id="i-tennis" viewBox="0 0 24 24"><ellipse cx="14" cy="9" rx="6" ry="7" transform="rotate(38 14 9)"/><path d="m10 14-7 8m4-4-3-2m8-13 7 9M9 6l7 9m-6-3 8-8m-5 11 8-8"/></symbol>
    <symbol id="i-game" viewBox="0 0 24 24"><path d="M7 6h10c3 0 4 4 4 9 0 4-3 4-6 0H9c-3 4-6 4-6 0 0-5 1-9 4-9Z"/><path d="M8 9v6m-3-3h6m5-2h.1m2 3h.1"/></symbol>
    <symbol id="i-flame" viewBox="0 0 24 24"><path d="M12 3c1 6 7 6 7 12a7 7 0 0 1-14 0c0-3 2-6 4-8 0 4 2 4 3 5 2-3 1-5 0-9Z"/></symbol>
    <symbol id="i-star" viewBox="0 0 24 24"><path d="m12 3 3 6 6 1-4.5 4.5 1 6.5-5.5-3-5.5 3 1-6.5L3 10l6-1 3-6Z"/></symbol>
    <symbol id="i-search" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></symbol>
    <symbol id="i-bell" viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/></symbol>
    <symbol id="i-close" viewBox="0 0 24 24"><path d="m6 6 12 12M6 18 18 6"/></symbol>
    <symbol id="i-check" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></symbol>
    <symbol id="i-lock" viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/></symbol>
    <symbol id="i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></symbol>
    <symbol id="i-trophy" viewBox="0 0 24 24"><path d="M7 3h10v6a5 5 0 0 1-10 0V3Zm0 2H3v3c0 3 2 4 5 4m9-7h4v3c0 3-2 4-5 4m-4 2v7m-5 0h10"/></symbol>
    <symbol id="i-cricket" viewBox="0 0 24 24"><path d="m15 3 6 6-9 9-6-6 9-9ZM8 16l-5 5m13-17 4 4"/><circle cx="5" cy="5" r="2"/></symbol>
    <symbol id="i-boxing" viewBox="0 0 24 24"><path d="M7 19h10v3H7zm0 0-4-8V8a2 2 0 0 1 4 0V4a2 2 0 0 1 4 0 2 2 0 0 1 4 0v1a2 2 0 0 1 4 0v7l-2 7"/></symbol>
  </defs></svg>

  <header class="site-header">
    <a class="brand" href="/" aria-label="EDGE home">EDGE<span class="brand-asterisk">✳</span><sup>®</sup></a>
    <nav class="main-nav" aria-label="Main navigation">
      <button class="nav-link active" data-page="sports">Sports</button>
      <button class="nav-link" data-page="live">Live <span class="nav-dot"></span></button>
      <button class="nav-link" data-page="games">Games</button>
      <button class="nav-link" data-page="copy">Copy Staking</button>
      <button class="nav-link" data-page="bets">My bets <span class="nav-count" id="bets-count">2</span></button>
      <button class="nav-link" data-page="admin" id="admin-nav">Admin</button>
    </nav>
    <div class="header-actions">
      <button class="header-wallet" data-page="wallet"><span class="tiny-label">YOUR WALLET</span><strong data-balance>$124,500.00</strong><svg><use href="#i-chevron"/></svg></button>
      <button class="button green header-deposit" data-wallet="deposit"><svg><use href="#i-plus"/></svg> Deposit</button>
      <button class="icon-button notification-button" id="notifications-button" aria-label="Notifications"><svg><use href="#i-bell"/></svg><i></i></button>
      <button class="avatar" id="profile-button" aria-label="Open account menu">JA</button>
    </div>
    <div class="popover" id="header-popover" hidden></div>
  </header>

  <main class="main-shell" id="app-shell" aria-busy="false">
    <div class="page-topline"><span><span class="status-dot"></span> THE HOME OF YOUR NEXT MOVE</span><span class="topline-right">PLAY SMART. STAY IN CONTROL. <span class="age-badge">18+</span></span></div>

    <div id="sports-page" class="page-panel">
      <section class="hero-grid" aria-label="Welcome to EDGE">
        <div class="hero">
          <img class="hero-image nfl-hero" src="/assets/game-nfl.jpg" alt="NFL quarterback Tom Brady in a New England Patriots helmet preparing to throw a football">
          <div class="hero-shade"></div>
          <div class="hero-content">
            <span class="eyebrow hero-eyebrow"><span class="green-dot"></span> FOR THE LOVE OF THE GAME</span>
            <h1>YOUR GAME.<br>YOUR <span>EDGE.</span><span class="headline-star">✳</span></h1>
            <p>Big moments. Bold moves.<br>A whole new way to get in the game.</p>
            <button class="button white hero-cta" id="explore-button">Explore sports <svg><use href="#i-arrow"/></svg></button>
          </div>
          <div class="hero-index"><span>01 / 03</span><span class="hero-progress"><i></i></span><span>BUILT FOR THE GAME ↗</span></div>
          <span class="hero-watermark">E.</span>
          <span class="nfl-photo-credit">Photo: <a href="https://commons.wikimedia.org/wiki/File:Tom_Brady.jpg" target="_blank" rel="noopener noreferrer">Keith Allison</a> · <a href="https://creativecommons.org/licenses/by-sa/2.0/" target="_blank" rel="noopener noreferrer">CC BY-SA 2.0</a></span>
        </div>
        <aside class="wallet-card" aria-label="Your wallet overview">
          <div class="wallet-card-top"><span class="eyebrow">YOUR WALLET</span><span class="wallet-symbol"><svg><use href="#i-wallet"/></svg></span></div>
          <div class="balance-caption">Available balance <span class="demo-badge">DEMO</span></div>
          <div class="wallet-balance" data-balance>$124,500<span>.00</span></div>
          <div class="wallet-profit"><span>↗</span> <strong data-profit>$24,500.00</strong><span>Total profit</span></div>
          <div class="wallet-actions"><button class="button green" data-wallet="deposit"><svg><use href="#i-plus"/></svg> Deposit</button><button class="button outline" data-wallet="withdraw">Withdraw <svg><use href="#i-arrow"/></svg></button></div>
          <div class="wallet-divider"></div>
          <div class="wallet-stats"><div><span>Active stakes</span><strong data-stakes>$8,500.00</strong></div><div><span>Potential returns</span><strong class="green-text" data-returns>$21,675.00</strong></div></div>
          <button class="wallet-history-link" data-page="wallet">View wallet history <svg><use href="#i-arrow"/></svg></button>
          <div class="wallet-security"><svg><use href="#i-lock"/></svg> YOUR WALLET. YOUR CONTROL.</div>
        </aside>
      </section>

      <div class="activity-strip"><span><i></i> <strong>THE GAME NEVER STOPS</strong></span><span>124 <small>live events</small></span><span>32 <small>sports to explore</small></span><span class="strip-end">FIND YOUR NEXT PLAY <svg><use href="#i-arrow"/></svg></span></div>

      <section class="sports-section" id="markets-section">
        <div class="sports-tabs" role="tablist" aria-label="Filter by sport">
          <button class="sport-tab active" role="tab" aria-selected="true" data-sport="all"><svg><use href="#i-flame"/></svg> For you <span>36</span></button>
          <button class="sport-tab" role="tab" aria-selected="false" data-sport="football"><svg><use href="#i-football"/></svg> Football <span>18</span></button>
          <button class="sport-tab" role="tab" aria-selected="false" data-sport="basketball"><svg><use href="#i-basketball"/></svg> Basketball <span>8</span></button>
          <button class="sport-tab" role="tab" aria-selected="false" data-sport="tennis"><svg><use href="#i-tennis"/></svg> Tennis <span>6</span></button>
          <button class="sport-tab" role="tab" aria-selected="false" data-sport="cricket"><svg><use href="#i-cricket"/></svg> Cricket <span>2</span></button>
          <button class="sport-tab" role="tab" aria-selected="false" data-sport="boxing"><svg><use href="#i-boxing"/></svg> Boxing <span>2</span></button>
          <button class="sport-tab esports-tab" role="tab" aria-selected="false" data-sport="esports"><svg><use href="#i-game"/></svg> Esports</button>
        </div>
        <div class="markets-layout">
          <div class="markets-main">
            <div class="section-heading"><div><span class="section-kicker">IN THE MOMENT / 001</span><h2 id="market-title">Live & upcoming<span class="green-text">.</span></h2></div><div class="market-tools"><button class="live-filter" id="live-filter"><span class="status-dot"></span> Live only <span class="toggle"></span></button><button class="icon-button bordered" id="search-toggle" aria-label="Search matches"><svg><use href="#i-search"/></svg></button></div></div>
            <div class="match-search" id="match-search" hidden><svg><use href="#i-search"/></svg><input id="search-input" type="search" placeholder="Search teams or competitions…" aria-label="Search teams or competitions"></div>
            <div class="league-tabs" role="tablist" aria-label="Filter competitions"><button class="active" data-league="all">All events</button><button data-league="Premier League">Premier League</button><button data-league="Champions League">Champions League</button><button data-league="La Liga">La Liga</button><button data-league="NBA">NBA</button></div>
            <div id="match-list" class="match-list"></div>
            <button class="view-all-button" id="view-all-events">View all events <span id="event-total">(18)</span> <svg><use href="#i-arrow"/></svg></button>
            <div class="games-preview-header section-heading"><div><span class="section-kicker">A DIFFERENT WAY TO PLAY / 002</span><h2>Switch up the game<span class="green-text">.</span></h2></div><button class="text-button" data-page="games">All games <svg><use href="#i-arrow"/></svg></button></div>
            <div class="game-grid" id="home-games"></div>
          </div>
          <aside class="betslip" id="betslip"><div class="betslip-title"><h3>BET SLIP <span id="slip-count">0</span></h3><svg><use href="#i-arrow"/></svg></div><div class="slip-tabs"><button class="active" data-bet-type="single">Single</button><button data-bet-type="multiple">Multiple</button></div><div id="slip-content"></div><div class="slip-note"><svg><use href="#i-lock"/></svg> Secure stakes. Transparent returns.</div></aside>
        </div>
      </section>
    </div>

    <section id="games-page" class="page-panel" hidden><div class="subpage-heading"><span class="section-kicker">FIND YOUR NEXT FAVORITE / 002</span><h1>MORE WAYS<br>TO <span class="green-text">PLAY.</span></h1><p>Quick rounds. New challenges. Every game is a new move.</p></div><div class="games-info"><svg><use href="#i-game"/></svg><span>Free play arcade — explore game previews with no wallet deductions.</span></div><div class="game-grid full-game-grid" id="all-games"></div></section>

    <section id="copy-page" class="page-panel" hidden aria-label="Copy staking">
      <div class="copy-hero-grid">
        <div class="copy-hero">
          <span class="eyebrow"><span class="green-dot"></span> YOUR NEXT MOVE, TOGETHER / 003</span>
          <h1>A SHARED<br><span>EDGE.</span><span class="copy-hero-star" aria-hidden="true">✳</span></h1>
          <p>Follow a strategy. Fund your allocation.<br>Copy its future stakes.</p>
          <button class="button green" id="copy-explore">Explore strategies <svg><use href="#i-arrow"/></svg></button>
          <div class="copy-hero-bottom"><span>INDEPENDENT STRATEGIES. YOUR CONTROL.</span><span>01 — COPY / STAKE</span></div>
          <span class="copy-hero-orbit" aria-hidden="true"></span>
        </div>
        <aside class="copy-overview" aria-label="Your copy staking overview">
          <div class="copy-overview-title"><span class="eyebrow">YOUR COPY CAPITAL</span><span class="demo-badge">DEMO</span></div>
          <span class="copy-capital-label">Copy position value</span>
          <strong class="copy-capital" id="copy-total-allocated">$0.00</strong>
          <div class="copy-overview-metrics"><div><span>Copy profit</span><strong id="copy-total-profit">$0.00</strong></div><div><span>Active strategies</span><strong id="copy-active-count">0</strong></div></div>
          <div class="copy-available"><span>Available wallet balance</span><strong data-balance>$124,500.00</strong></div>
          <button class="copy-wallet-link" data-wallet="deposit">Add funds to wallet <svg><use href="#i-plus"/></svg></button>
          <p class="copy-overview-note">Choose a strategy below to deposit into copy staking.</p>
        </aside>
      </div>
      <div class="copy-demo-note"><span class="demo-badge">DEMO EXPERIENCE</span><p>Strategies and performance are illustrative. Returns can vary and stakes can be lost. No real money is transferred.</p></div>
      <div class="copy-how"><span class="copy-how-heading">HOW IT WORKS <svg><use href="#i-arrow"/></svg></span><div><span>01</span><p>Find your strategy</p></div><div><span>02</span><p>Deposit your allocation</p></div><div><span>03</span><p>Track & manage your funds</p></div></div>
      <section id="copy-strategies" class="copy-strategies" aria-labelledby="copy-strategies-title">
        <div class="section-heading copy-section-heading"><div><span class="section-kicker">DIFFERENT APPROACHES. ONE GAME.</span><h2 id="copy-strategies-title">Find your shared edge<span class="green-text">.</span></h2></div><label class="copy-filter-label" for="copy-risk-filter"><span>Strategy style</span><select id="copy-risk-filter"><option value="all">All strategies</option><option value="measured">Measured</option><option value="balanced">Balanced</option><option value="dynamic">Dynamic</option></select></label></div>
        <div id="copy-strategy-list" class="copy-strategy-grid"></div>
        <p class="copy-performance-note">Sample performance describes a fictional past period. It does not predict future results.</p>
      </section>
      <section class="copy-positions" aria-labelledby="copy-positions-title"><div class="section-heading copy-section-heading"><div><span class="section-kicker">YOUR ALLOCATION. YOUR CALL.</span><h2 id="copy-positions-title">Your copy positions<span class="green-text">.</span></h2></div><div class="copy-position-filters" role="group" aria-label="Filter copy positions"><button class="active" data-copy-position-filter="active">Active</button><button data-copy-position-filter="all">All positions</button></div></div><div id="copy-position-list" class="copy-position-list"></div></section>
    </section>

    <section id="wallet-page" class="page-panel" hidden><div class="subpage-heading"><span class="section-kicker">YOUR MONEY. YOUR MOVE. / 004</span><h1>THE <span class="green-text">WALLET.</span></h1><p>Keep track of every stake, return and transaction.</p></div><div class="wallet-overview"><div class="wallet-total"><span class="eyebrow">AVAILABLE DEMO BALANCE</span><strong data-balance>$124,500.00</strong><div><button class="button green" data-wallet="deposit"><svg><use href="#i-plus"/></svg> Deposit funds</button><button class="button outline" data-wallet="withdraw">Withdraw funds <svg><use href="#i-arrow"/></svg></button></div></div><div class="wallet-overview-stat"><svg><use href="#i-trophy"/></svg><span>Total profit</span><strong data-profit>$24,500.00</strong></div><div class="wallet-overview-stat"><svg><use href="#i-clock"/></svg><span>Active stakes</span><strong data-stakes>$8,500.00</strong></div></div><div class="section-heading transaction-heading"><h2>Transaction history<span class="green-text">.</span></h2><select id="transaction-filter" aria-label="Filter transactions"><option value="all">All transactions</option><option value="deposit">Deposits</option><option value="promo_credit">Promotional credits</option><option value="withdrawal">Withdrawals</option><option value="stake">Stakes</option><option value="return">Returns</option><option value="copy">Copy staking</option></select></div><div class="transaction-table-wrap"><table class="transaction-table"><thead><tr><th>TRANSACTION</th><th>DATE</th><th>AMOUNT</th><th>STATUS</th></tr></thead><tbody id="transaction-body"></tbody></table></div><p class="demo-explanation">Demo wallet • Transactions are saved in this browser. Payment providers and bank transfers are not connected.</p></section>

    <section id="bets-page" class="page-panel" hidden><div class="subpage-heading"><span class="section-kicker">EVERY MOVE, IN ONE PLACE / 005</span><h1>YOUR <span class="green-text">PLAYS.</span></h1><p>Follow your active stakes and revisit your results.</p></div><div class="bet-history-tabs"><button class="active" data-bet-filter="active">Active <span id="active-bet-count">2</span></button><button data-bet-filter="settled">Settled</button><button data-bet-filter="all">All bets</button></div><div id="bet-history" class="bet-history"></div></section>

    @include('partials.admin')
    @include('partials.kyc')
    @include('partials.support')
    @include('partials.promo')
    @include('partials.manual-methods')

    <section class="bottom-banner"><div><span class="eyebrow">BACK YOUR KNOWLEDGE. OWN YOUR GAME.</span><h2>MAKE YOUR NEXT MOVE<span>.</span></h2></div><span class="bottom-asterisk">✳</span></section>
  </main>
  <footer class="site-footer"><a class="brand footer-brand" href="/">EDGE<span class="brand-asterisk">✳</span><sup>®</sup></a><p>For the love of the game.</p><div><button data-info="responsible">Responsible play</button><button data-support-open>Help & support</button><button data-info="terms">Terms</button></div><span class="footer-note">18+ &nbsp; PLAY WITHIN YOUR LIMITS.<br>© 2026 EDGE. Demo experience.</span></footer>

  <div class="modal-backdrop" id="wallet-modal" hidden><section class="modal wallet-modal" role="dialog" aria-modal="true" aria-labelledby="wallet-modal-title"><button class="icon-button modal-close" data-close-modal aria-label="Close dialog"><svg><use href="#i-close"/></svg></button><span class="section-kicker">YOUR WALLET. YOUR CONTROL.</span><h2 id="wallet-modal-title">MAKE A DEPOSIT<span>.</span></h2><p class="modal-description" id="wallet-modal-description">Add demo funds and get ready for your next move.</p><div class="modal-wallet-tabs"><button class="active" data-modal-wallet="deposit">Deposit</button><button data-modal-wallet="withdraw">Withdraw</button></div><form id="wallet-form"><label for="wallet-amount">Amount <span>USD</span></label><div class="amount-input"><span>$</span><input id="wallet-amount" inputmode="decimal" type="number" min="100" step="0.01" placeholder="0.00" required></div><div class="amount-presets"><button type="button" data-amount="1000">$1,000</button><button type="button" data-amount="5000">$5,000</button><button type="button" data-amount="10000">$10,000</button><button type="button" data-amount="25000">$25,000</button></div><label for="wallet-method" id="wallet-method-label">Payment method</label><select id="wallet-method"><option value="bank">Bank transfer (demo)</option><option value="card">Debit card (demo)</option></select><div id="withdraw-fields" hidden><label for="bank-name">Bank</label><select id="bank-name"><option value="">Select your bank</option><option>Access Bank</option><option>First Bank</option><option>GTBank</option><option>Moniepoint</option><option>OPay</option><option>United Bank for Africa</option><option>Zenith Bank</option></select><label for="account-number">Account number</label><input id="account-number" inputmode="numeric" maxlength="10" pattern="[0-9]{10}" placeholder="10-digit account number"><label for="account-name">Account holder name</label><input id="account-name" autocomplete="off" maxlength="80" placeholder="Full name on your account"></div><div class="form-error" id="wallet-error" role="alert" hidden></div><div class="wallet-form-summary"><span>Available balance</span><strong data-balance>$124,500.00</strong></div><button type="submit" class="button green wallet-submit" id="wallet-submit">Add demo funds <svg><use href="#i-arrow"/></svg></button><p class="modal-fine-print"><svg><use href="#i-lock"/></svg> Demo mode. No real money is transferred. Use sample details.</p></form></section></div>
  <div class="modal-backdrop" id="info-modal" hidden><section class="modal info-modal" role="dialog" aria-modal="true" aria-labelledby="info-title"><button class="icon-button modal-close" data-close-modal aria-label="Close dialog"><svg><use href="#i-close"/></svg></button><div id="info-content"></div></section></div>
  <div class="toast" id="toast" role="status" aria-live="polite" hidden></div>
  <button class="mobile-slip-button" id="mobile-slip-button">Bet slip <span id="mobile-slip-count">0</span><svg><use href="#i-chevron"/></svg></button>
</body>
</html>
