<header class="landing-header">
  <a class="landing-brand" href="/" aria-label="EDGE home">EDGE<span aria-hidden="true">✳</span><sup>®</sup></a>
  <button class="landing-menu-toggle" type="button" aria-expanded="false" aria-controls="landing-navigation" hidden><span>Menu</span><i aria-hidden="true"></i></button>
  <nav class="landing-navigation" id="landing-navigation" aria-label="Main navigation">
    @foreach(config('marketing.navigation') as $slug => $label)
      <a href="/{{ $slug }}" data-marketing-page @if(($pageSlug ?? '') === $slug) aria-current="page" @endif>{{ $label }}</a>
    @endforeach
    <a class="mobile-signin" href="/app?auth=login#sports">Sign in ↗</a>
  </nav>
  <div class="landing-header-actions"><a class="landing-signin" href="/app?auth=login#sports">Sign in</a><a class="landing-button compact green" href="/app?auth=register#sports">Get started <span aria-hidden="true">↗</span></a></div>
</header>
