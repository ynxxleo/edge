<section id="verification-page" class="page-panel" hidden aria-labelledby="kyc-page-title">
  <header class="kyc-hero">
    <div><span class="eyebrow"><span class="green-dot"></span> YOUR ACCOUNT / VERIFICATION</span><h1 id="kyc-page-title">MAKE IT<br><span>OFFICIAL.</span></h1><p>A quick identity check. A more secure account.<br>Get verified before your first withdrawal.</p></div>
    <div class="kyc-hero-seal" aria-hidden="true"><svg><use href="#i-check"/></svg><span>VERIFIED<br>TO MOVE ↗</span></div>
    <span class="kyc-hero-index">ONE ACCOUNT. YOUR IDENTITY. / 01</span>
  </header>
  <div class="kyc-reason-notice" id="kyc-reason-notice" hidden></div>
  <div class="kyc-preview-notice" id="kyc-preview-notice" hidden><span class="demo-badge">READ-ONLY PREVIEW</span><p>Identity verification is available in the Laravel app. Do not upload real documents in this preview.</p></div>
  <div class="kyc-layout">
    <div id="kyc-customer-content" aria-live="polite"><div class="kyc-empty"><svg><use href="#i-lock"/></svg><h2>Your identity. Your control.</h2><p>Sign in to submit your identity documents for administrator review.</p><button class="button green" data-kyc-signin>Sign in <svg><use href="#i-arrow"/></svg></button></div></div>
    <aside class="kyc-guide" aria-label="Verification guide"><span class="section-kicker">A CLEAR PATH TO VERIFIED</span><h2>THREE STEPS.<br>ONE <span>YOU.</span></h2><ol><li><span>01</span><div><h3>Your details</h3><p>Enter your legal name and the details shown on your identity document.</p></div></li><li><span>02</span><div><h3>Your documents</h3><p>Upload a clear identity document and a recent selfie. Make sure your face and document details are readable.</p></div></li><li><span>03</span><div><h3>Admin review</h3><p>Our administrator reviews your submission. Approval unlocks withdrawal requests.</p></div></li></ol><div class="kyc-private-note"><svg><use href="#i-lock"/></svg><p>Your files are private. Only you and authorised administrators can access your submission.</p></div></aside>
  </div>
</section>

<template id="kyc-admin-template">
  <div id="admin-kyc-tab" class="admin-tab-panel" role="tabpanel" aria-labelledby="admin-tab-kyc" hidden>
    <div class="admin-content-heading"><div><span class="section-kicker">KNOW YOUR PLAYERS / 05</span><h2>Identity desk<span>.</span></h2><p>Review identity documents and approve eligible accounts for withdrawals.</p></div><button class="admin-small-button" id="kyc-review-refresh"><svg><use href="#i-clock"/></svg> Refresh KYC</button></div>
    <nav class="kyc-workspace-nav" aria-label="Identity desk sections"><button type="button" data-kyc-section="reviews" aria-current="page">Review queue</button><button type="button" data-kyc-section="requirements">Requirements & users</button></nav>
    <div id="kyc-reviews-workspace">
    <div class="kyc-review-toolbar"><div class="kyc-review-context"><svg><use href="#i-lock"/></svg><span>Private documents / administrator access</span></div><label>Show<select id="kyc-review-status" aria-label="Filter verification requests"><option value="pending">Pending review</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="all">All submissions</option></select></label></div>
    <div class="kyc-message" id="kyc-admin-message" role="status" hidden></div>
    <div id="kyc-review-list" class="kyc-review-list" aria-live="polite"></div>
    <div class="kyc-pagination" id="kyc-review-pagination" hidden><button class="admin-small-button" data-kyc-page="previous">Previous</button><span id="kyc-review-page-label"></span><button class="admin-small-button" data-kyc-page="next">Next</button></div>
    </div>
    <div id="kyc-requirements-workspace" hidden>
      <div class="kyc-message" id="kyc-requirements-message" role="status" hidden></div>
      <div id="kyc-requirements-content" aria-live="polite"></div>
      <section class="kyc-assignment-desk" aria-labelledby="kyc-assignment-title"><div class="kyc-builder-heading"><div><span class="section-kicker">REQUIREMENTS / INDIVIDUAL ACCOUNTS</span><h3 id="kyc-assignment-title">The right checks for each user<span>.</span></h3><p>Choose an account, then assign the layers and explanation that apply to that user.</p></div></div><form id="kyc-user-search-form" class="kyc-user-search" role="search"><label class="kyc-field"><span>Find a user by name or email</span><input id="kyc-user-search" name="search" type="search" maxlength="150" autocomplete="off" placeholder="Name or email address"></label><button type="submit" class="button outline">Search users <svg><use href="#i-arrow"/></svg></button></form><div class="kyc-message" id="kyc-users-message" role="status" hidden></div><div id="kyc-users-list" class="kyc-users-list" aria-live="polite"></div><div id="kyc-users-pagination" class="kyc-pagination" hidden><button type="button" class="admin-small-button" data-kyc-users-page="previous">Previous</button><span id="kyc-users-page-label"></span><button type="button" class="admin-small-button" data-kyc-users-page="next">Next</button></div><div id="kyc-user-assignment" aria-live="polite"></div></section>
    </div>
  </div>
</template>

<div class="kyc-dialog-backdrop" id="kyc-review-dialog" hidden>
  <section class="kyc-dialog" role="dialog" aria-modal="true" aria-labelledby="kyc-review-title"><button class="icon-button kyc-dialog-close" data-kyc-close aria-label="Close identity review"><svg><use href="#i-close"/></svg></button><div id="kyc-review-content"></div></section>
</div>
