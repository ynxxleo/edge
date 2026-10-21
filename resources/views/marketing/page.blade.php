<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#111310">
  <meta name="description" content="{{ $page['description'] }}">
  <title>{{ $page['title'] }} — EDGE</title>
  <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
  <link rel="preload" href="/assets/fonts/barlow-condensed-800.ttf" as="font" type="font/ttf" crossorigin>
  <link rel="stylesheet" href="/assets/fonts.css">
  <link rel="stylesheet" href="/assets/landing.css">
  <link rel="stylesheet" href="/assets/marketing.css">
  <link rel="stylesheet" href="/assets/motion.css">
  <script src="/assets/motion.js" defer></script>
  <script src="/assets/landing.js" defer></script>
</head>
<body class="landing-body marketing-body" data-edge-preload="page">
  <a class="skip-link" href="#main-content">Skip to content</a>
  <div id="edge-page-loader" class="edge-page-loader" aria-hidden="true" hidden><span class="edge-loader-mark">EDGE<span>✳</span></span><span class="edge-loader-caption">GETTING THE GAME READY</span></div>
  @include('marketing.header')
  <main id="main-content">
    <section class="marketing-hero {{ isset($page['visual']) ? 'has-visual' : 'is-document' }}" aria-labelledby="page-title">
      <div class="marketing-breadcrumb"><a href="/">Home</a><span aria-hidden="true">/</span><span>{{ $page['title'] }}</span><span class="marketing-index">EDGE / {{ str_pad((string) $pageIndex, 2, '0', STR_PAD_LEFT) }}</span></div>
      <div class="marketing-hero-grid">
        <div class="marketing-hero-copy" data-reveal>
          <p class="landing-eyebrow"><span class="live-dot" aria-hidden="true"></span>{{ $page['eyebrow'] }}</p>
          <h1 id="page-title">{{ $page['heading'][0] }}<br><span>{{ $page['heading'][1] }}</span></h1>
          <p class="marketing-description">{{ $page['description'] }}</p>
          @if(isset($page['action']))<a class="landing-button green" href="{{ $page['action'][1] }}">{{ $page['action'][0] }} <span aria-hidden="true">↗</span></a>@endif
        </div>
        @if(isset($page['visual']))
          <div class="marketing-visual visual-{{ $page['visual'] }}" data-reveal>
            @if($page['visual'] === 'sports')
              <img src="/assets/game-nfl.jpg" width="960" height="1763" alt="NFL quarterback Tom Brady preparing a throw" fetchpriority="high">
              <span class="marketing-photo-label">THE FIELD IS YOURS. <b aria-hidden="true">↗</b></span>
              <span class="marketing-photo-credit">Photo: <a href="https://commons.wikimedia.org/wiki/File:Tom_Brady.jpg" target="_blank" rel="noopener noreferrer">Keith Allison</a> · <a href="https://creativecommons.org/licenses/by-sa/2.0/" target="_blank" rel="noopener noreferrer">CC BY-SA 2.0</a></span>
            @elseif($page['visual'] === 'copy')
              <div class="marketing-demo-top"><span class="landing-eyebrow">ILLUSTRATIVE CAPITAL</span><span>USD ↗</span></div>
              <strong class="marketing-demo-value">$1,085<span>.00</span></strong>
              <svg class="marketing-demo-chart" viewBox="0 0 400 180" role="img" aria-labelledby="example-chart-title"><title id="example-chart-title">Fictional example: 1,000 dollars becomes 1,060 after a win, 1,020 after a loss, then 1,085 after a win.</title><path d="M15 35H385M15 95H385M15 155H385" class="demo-grid"/><path d="M20 145L140 70L260 120L380 39V170H20Z" class="demo-area"/><path d="M20 145L140 70L260 120L380 39" class="demo-line"/><g class="demo-dots"><circle cx="20" cy="145" r="5"/><circle cx="140" cy="70" r="5"/><circle cx="260" cy="120" r="5"/><circle cx="380" cy="39" r="5"/></g></svg>
              <div class="marketing-demo-game"><span>Northside vs Riverside</span><b>Won +$60</b></div><div class="marketing-demo-game"><span>Harbour vs Athletic</span><b class="demo-loss">Lost −$40</b></div><div class="marketing-demo-game"><span>East City vs West United</span><b>Won +$65</b></div>
              <p class="marketing-demo-note">Fictional teams and results. An explanation, not a performance forecast.</p>
            @elseif($page['visual'] === 'wallet')
              <div class="marketing-demo-top"><span class="landing-eyebrow">YOUR WALLET / EXAMPLE</span><span aria-hidden="true">✳</span></div>
              <span class="marketing-balance-label">Available balance</span><strong class="marketing-demo-value">$500<span>.00</span></strong>
              <div class="marketing-wallet-pills"><span>Deposit ↗</span><span>Withdraw ↗</span></div>
              <div class="marketing-demo-game"><span>Deposit confirmed</span><b>+$600</b></div><div class="marketing-demo-game"><span>Sports stake</span><b class="demo-loss">−$100</b></div>
              <p class="marketing-demo-note">Illustrative wallet. Your live balance comes from confirmed account activity.</p>
            @elseif($page['visual'] === 'steps')
              <span class="landing-eyebrow">FROM FIRST SIGN-IN TO FINAL SCORE</span><ol class="marketing-visual-steps"><li><span>01</span><strong>JOIN.</strong><small>Verify your email.</small></li><li><span>02</span><strong>CHOOSE.</strong><small>Review your next move.</small></li><li><span>03</span><strong>FOLLOW.</strong><small>See the result.</small></li></ol>
            @else
              <span class="landing-eyebrow">MADE FOR THE LOVE OF THE GAME</span><div class="marketing-brand-orbit" aria-hidden="true"><span>✳</span></div><p class="marketing-brand-caption">SPORTS. STRATEGY.<br>YOUR NEXT MOVE.</p>
            @endif
          </div>
        @else
          <div class="marketing-document-mark" aria-hidden="true">✳<span>THE DETAILS<br>BEHIND THE GAME.</span></div>
        @endif
      </div>
    </section>
    <div class="marketing-reading-layout">
      <aside class="marketing-contents"><p class="landing-eyebrow">ON THIS PAGE</p><nav aria-label="On this page">@foreach($page['sections'] as $section)<a href="#{{ $section['id'] ?? \Illuminate\Support\Str::slug($section['title']) }}"><span>{{ str_pad((string) $loop->iteration, 2, '0', STR_PAD_LEFT) }}</span>{{ $section['title'] }}</a>@endforeach</nav><a class="marketing-back" href="/">Back to home ↗</a></aside>
      <div class="marketing-articles">
        @foreach($page['sections'] as $section)
          <section class="marketing-article" id="{{ $section['id'] ?? \Illuminate\Support\Str::slug($section['title']) }}" aria-labelledby="section-title-{{ $loop->iteration }}" data-reveal>
            <span class="marketing-section-number">{{ str_pad((string) $loop->iteration, 2, '0', STR_PAD_LEFT) }} /</span><div><h2 id="section-title-{{ $loop->iteration }}">{{ $section['title'] }}</h2><p>{{ $section['text'] }}</p>
            @if(isset($section['points']))<ul>@foreach($section['points'] as $point)<li>{{ $point }}</li>@endforeach</ul>@endif
            @if(isset($section['link']))<a class="landing-text-link" href="{{ $section['link'][1] }}">{{ $section['link'][0] }} <span aria-hidden="true">↗</span></a>@endif</div>
          </section>
        @endforeach
        @if(isset($page['faq']))<section class="marketing-faq" aria-labelledby="more-answers"><h2 id="more-answers">A FEW MORE ANSWERS.</h2><div class="faq-list">@foreach($page['faq'] as $faq)<details><summary>{{ $faq['question'] }}<span aria-hidden="true">+</span></summary><p>{{ $faq['answer'] }}</p></details>@endforeach</div></section>@endif
      </div>
    </div>
    <section class="marketing-next"><span class="landing-eyebrow">KEEP YOUR NEXT MOVE CLEAR.</span><h2>{{ $pageSlug === 'help' || $pageSlug === 'contact' ? 'YOUR ACCOUNT. YOUR SUPPORT.' : 'THE DETAILS MAKE THE DIFFERENCE.' }}</h2><a class="landing-text-link" href="{{ $pageSlug === 'help' || $pageSlug === 'contact' ? '/app?auth=login#sports' : '/help' }}">{{ $pageSlug === 'help' || $pageSlug === 'contact' ? 'Open account support' : 'Explore the help centre' }} <span aria-hidden="true">↗</span></a></section>
  </main>
  @include('marketing.footer')
</body>
</html>
