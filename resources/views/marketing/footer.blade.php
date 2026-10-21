<footer class="landing-footer marketing-footer">
  <div class="marketing-footer-brand"><a class="landing-brand" href="/" aria-label="EDGE home">EDGE<span aria-hidden="true">✳</span></a><p>Your game. Your edge.</p></div>
  <div class="marketing-footer-links"><span class="landing-eyebrow">THE DETAILS MATTER</span><nav aria-label="Footer navigation">
    @foreach(config('marketing.footer') as $slug => $label)
      <a href="/{{ $slug }}" @if(($pageSlug ?? '') === $slug) aria-current="page" @endif>{{ $label }} <span aria-hidden="true">↗</span></a>
    @endforeach
  </nav></div>
  <div class="marketing-footer-bottom"><p>18+ only. Play responsibly.<br>Stakes can be lost. Returns are not guaranteed.</p><a href="/responsible-play">Stay in control <span aria-hidden="true">↗</span></a><span>© {{ date('Y') }} EDGE</span></div>
</footer>
