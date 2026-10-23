# EDGE — Laravel staking system

A Laravel 13 application with a public landing page, persistent user accounts, administrator-managed games and odds, transactional wallets, single and multiple stakes, copy staking, and settlement from final scores. The existing black, white, and neon green interface is retained. The Laravel application is hosted at edgepremiums.com.

## Hosted installation

The Laravel application is deployed at https://edgepremiums.com and the admin desk is at https://edgepremiums.com/admin. Production uses a separate MySQL database with no imported local test funds or sample games. See [DEPLOYMENT.md](DEPLOYMENT.md) for the verified Namecheap paths and Git release workflow.

## Open this workspace

The SQLite database is migrated and seeded with fictional future fixtures and three copy strategies. A local administrator was created with a generated password, stored in the ignored, private file [.local/admin-login.txt](.local/admin-login.txt). No balances are preloaded.

```sh
php artisan serve --host=127.0.0.1 --port=8135
```

Open http://127.0.0.1:8135 for the landing page, http://127.0.0.1:8135/app for the staking platform, and http://127.0.0.1:8135/admin for the administrator. Landing-page sign-in and registration links open the corresponding account form in the platform. New registrations start with a zero balance. Use a separate browser profile or a private window to test a user and administrator simultaneously. Existing root hash links such as `/#copy` forward to `/app#copy`; older Stripe checkout return URLs also reach the platform wallet.

The initial platform preloader ends as soon as account and fixture data finish loading, or releases on failure with a bounded fallback for stalled startup. Action buttons show progress during submissions and return to their normal state after errors. Background refreshes leave the page and pending stake forms in place. Landing reveals, page transitions, dialogs, and hover effects respect the device's reduced-motion preference; there is no artificial minimum loading delay.

## Fresh installation

Requires PHP 8.3+, BCMath, PDO SQLite, and Composer. Assets are bundled in `public/assets`; Vite and a frontend dependency installation are not required.

```sh
composer install --no-dev
cp .env.example .env
php artisan key:generate
php artisan migrate --seed
php artisan edge:admin your-email@example.com --name="Your Name"
php artisan serve --host=127.0.0.1 --port=8135
```

The administrator command prompts privately for a password of at least 12 characters with letters and numbers. It can also reset/promote an existing account. There is no built-in administrator password. Rerunning the seeder preserves administrator edits and results.

## Administrator account top-ups

Open **Admin → Account top-ups**, search by name, email or EDGE account number, and select a user. Enter $1–$1,000,000 and a reason, review the recipient and amount, then confirm with your current administrator password. This creates an immediate direct wallet credit. It does not debit an administrator wallet or claim that an external payment was received. Ordinary withdrawal and transfer rules still apply.

The user sees **Admin top-up** in the wallet ledger and recent transactions, with its own history filter. The administrator desk has a paginated receipt history recording the operator, recipient, amount, reason, reference, and before/after balances. Reasons are encrypted and available only in admin receipts; they are omitted from user responses and the general audit feed.

The credit, immutable receipt and audit commit together. Administrator status and the password are checked on the locked current account, and the recipient number must match. A request key protects retries from duplicate credits; changing the recipient, amount or reason with the same key is rejected. The UI retains the key after an uncertain response and clears password inputs after submission or leaving the tab.

Run `php scripts/check-admin-topups.php` for validation, audit rollback and concurrent retries; `python3 scripts/check-admin-topups-api.py` checks OTP sessions, CSRF, permissions, private history and duplicate handling. These checks use disposable databases and synthetic credits. No real top-ups are issued during setup or deployment.

## Internal wallet transfers

Each existing and new user receives a permanent, random 10-digit EDGE account number. This identifies an internal USD wallet, not a bank account. Find it under **Wallet → EDGE transfers** and use **Copy** to share it.

Choose **Send money**, enter the recipient number and amount, check the masked recipient name and total, then enter your current password to confirm. Sending requires administrator-approved KYC. Transfers use available funds only, carry no platform fee, and allow $1–$1,000,000 per instruction within existing wallet limits. Self-transfers are rejected. Received funds are ordinary wallet funds; existing withdrawal rules still apply. Completed transfers cannot be cancelled.

Both parties receive a private, paginated receipt history, and the main transaction filter includes **Transfers**. Recipient discovery returns only a name with the last name reduced to an initial and an account number. There is no public account directory. Lookup and send endpoints have separate request limits. Recipient confirmations expire after 10 minutes and are bound to the sender and recipient. Passwords are checked again against the locked sender record and never stored in receipts.

Transfers lock both users in ID order, then create the receipt, debit and credit in one database transaction. A sender-scoped request key makes exact retries safe, while reusing the key with a different amount or recipient fails. Ledger entries net to zero and are immutable. The account-number migration preserves all existing balances; future model changes cannot replace an assigned number.

Run `php scripts/check-transfers.php` for migration, validation, rollback and concurrent duplicate/overspend checks; `python3 scripts/check-transfers-api.py` checks real OTP sessions, CSRF, KYC, receipt ownership and rate limits. Both use disposable databases and synthetic funds.

## Public information pages

The landing page and each public information page share five navigation links: **Sports**, **Copy staking**, **Wallet**, **How it works**, and **About**. The footer links to **Help centre**, **Contact**, **Responsible play**, **Terms of use**, **Privacy policy**, **Cookie policy**, **KYC & verification**, and **Payments & withdrawals**. No public footer links to the admin desk.

Each link opens a complete, guest-accessible Laravel page with its own title, description, section navigation and links to the relevant account screens. Contact directs users to the existing private support chat. Product examples are labelled illustrative. Policy text describes the implemented platform and makes no claims about licensing, guaranteed returns or payout times.

Content lives in `config/marketing.php`; shared Blade templates live in `resources/views/marketing/`. `npm run build` renders the same Blade pages through `scripts/render-marketing.php` into the static preview, including all 13 public pages. Building therefore requires the normal Laravel PHP dependencies. The live application serves these routes directly through Laravel.

## Email sign-up and login codes

Both sign-up and password login return a verification challenge (HTTP 202). Enter the six-digit email code in the platform to finish authentication. Sign-up creates the account only after the email is verified. Admins follow the same login flow. Codes expire after 10 minutes, allow five attempts, and can be resent after 60 seconds (eight messages per address per hour). Resending invalidates the previous code. A pending challenge resumes after refreshing the page in the same browser session.

Configure a real mail transport before using authentication. Production supports SMTP, sendmail, SES, Postmark, or Resend and rejects log/array mail transports. Namecheap can use `MAIL_MAILER=sendmail` and `MAIL_SENDMAIL_PATH="/usr/sbin/sendmail -t -i"`; configure `MAIL_FROM_ADDRESS` for the sending domain. Confirm the admin account has a working inbox before deployment. For local development, the default log transport writes the email to the private Laravel development log; use an SMTP sandbox when testing delivery.

The API endpoints are `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/verify` with `{ "code": "123456" }`, and `POST /api/auth/resend` with an empty JSON object. All require CSRF and session cookies. Verification creates a new authenticated session and rotates the CSRF token. Codes are hashed, pending details are encrypted, and consumed challenges are deleted. The scheduler removes stale challenges. No code is returned to the browser or logged in production.

Run `python3 scripts/check-email-otp-api.py` for isolated verification, expiry, lockout, resend, session ownership, administrator gating and mail failure checks. It captures test mail without external delivery. Existing financial HTTP fixtures also complete the OTP step through an array mail transport in their disposable routers; no production authentication bypass exists.

## Git deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for production setup, the environment template, persistent data requirements, and first-install versus later-release commands. The production strategy seeder creates no sample games, accounts or wallet balances.

## Administrator workflow

1. Create a game with its sport, competition, participants, scheduled start, status, and decimal home/draw/away odds. Publish it as **Open** to accept stakes before the scheduled start. **Draft** hides it; **Live** and **Suspended** stop new stakes.
2. Edit quotes while a game is unsettled. Version checks prevent one administrator from silently overwriting another's edit. Accepted stakes retain their original odds. Participants, sport, and the two-way/three-way market format cannot change after a stake or copy pick exists.
3. After a game ends, open **Set final score**, enter both scores, review, and confirm. The system determines the winning outcome, settles affected stakes, and credits winning returns. Final scores cannot be overwritten. A two-way market needs an untied final score including overtime; otherwise void it.
4. Void a canceled game with a reason. Singles are refunded; a void leg in a multiple contributes odds of 1.00. A multiple settles once all remaining legs resolve, or loses when any leg loses.
5. Review manual wallet requests. Approve a deposit only after verifying the external payment. Record a unique bank/provider reference. Withdrawal funds are reserved when requested; rejection returns them. Approve a withdrawal after making the external payment and record its reference.
6. Publish copy picks by choosing a strategy, an open game, and an outcome. Active positions receive a stake based on their available funds and the strategy percentage. Paused positions receive no new picks. The same final game result settles these stakes.
7. Open **Identity verification** in the admin desk to review pending KYC submissions. Open a submission, download its private ID and selfie, and confirm approval or rejection. Rejection requires a reason visible to the user. Administrators cannot review their own identity submissions.
8. Open **Support inbox** to read waiting conversations, claim one, reply to its owner, and mark it resolved. The user sees your replies in the same support chat. Another administrator's assigned conversation remains read-only.
9. Open **Credit codes** to create a promotional code, set its dollar value and optional expiry, and copy it for a user. Unused codes can be revoked; the list records who redeemed each code.

The dashboard also displays pending requests and an audit trail. Only administrator accounts can access its APIs; the `/admin` page itself displays a sign-in/access gate for other visitors.

## User workflow

- Register/sign in, browse published events, and select an outcome. A single contains one game; a multiple contains 2–20 distinct games. Stakes start at $1 and are capped at $1,000,000 per instruction.
- Choose card checkout through Stripe or a manual bank payment in the deposit dialog. Stripe deposits credit only after a signed, verified paid webhook. Manual deposits use the administrator-configured bank details and need approval.
- Redeem an administrator-issued 16-character credit code in **Wallet → Got a credit code?**. Its value becomes available wallet funds immediately after server confirmation.
- Place stakes from the available wallet. Final-score settlement updates My bets and the wallet ledger. The Laravel app does not offer the earlier demo's fabricated cash-out return.
- Allocate at least $100 to a copy position from the available wallet. Picks published afterward are copied automatically. Pause/resume anytime; close and return funds after all copied stakes settle.
- Open **Identity verification** from the account menu or wallet, submit your details, identity document and selfie, then wait for administrator approval.
- After KYC approval, choose a withdrawal method and complete its configured recipient details. Track pending, approved, and rejected requests in the wallet.
- Open **Need a hand?** or **Help & support** for private account questions, then request an administrator in the same chat.

Each copy position has a capital chart beginning at its deposited allocation. Settled wins add the actual payout minus the stake; losses subtract the stake, and refunded games leave capital unchanged. Pending stakes remain part of capital until they settle. The game history beneath the chart lists both teams, the result, and the user's net profit or loss. Chart points can be inspected with a pointer, touch, or keyboard. Closed positions retain their final performance history after the money returns to the wallet.

Stripe Checkout handles card entry and payment; card data never enters this application. Manual bank deposits and all withdrawals are reviewed by an administrator. The app does not initiate bank transfers or provide automated Stripe withdrawals. The supported betting market is match winner (home/draw/away), with draw optional for two-way sports. Historical browser-demo funds and simulated results are never imported into real account records.

## Promotional credit codes

In **Admin → Credit codes**, enter $1–$1,000,000, an optional promotion label and expiry, and your current administrator password. The server generates a random 16-character code containing letters and numbers. Copy it from the confirmation card before leaving the tab. Full codes appear only in the creation response or a retry of that same issuance request; subsequent lists show only the final four characters. Labels appear in the user's redemption history.

Each code is single-use across the platform. Redemption accepts either letter case and credits the full amount to the user's ordinary wallet. Funds can be staked, allocated to copy staking, or withdrawn without wagering requirements. Withdrawals still require approved KYC, the existing $100 minimum, sufficient available funds, and administrator payout review. A retry by the original redeemer returns its earlier receipt without adding funds again. Revoked, expired, or already-used codes cannot credit another account.

The admin list supports status filters and pagination. Revocation requires the current administrator password, confirmation, and the current record version. Redemption history is private to its owner. Codes are encrypted at rest with `APP_KEY` and looked up by hash; ledger and audit records contain no full codes or passwords. Issuance retries, competing redemptions, revocation, and wallet updates run through the existing transaction and locking protections.

The local schema is migrated. No promotional codes were issued and no existing account funds were changed during setup.

## Account support chat

The support widget is available throughout `/app` and `/admin`. Sign in, choose a quick topic or type a question. Automated support can read the current user's wallet balance, verification status, recent manual/card deposit activity, withdrawal requests, bet summary, and active or paused copy positions including unsettled stakes. It can also explain where to deposit, withdraw or verify. It cannot change account records, approve KYC, move funds, settle games or offer betting recommendations.

After three supported account answers, the conversation enters the administrator queue. Greetings do not consume the allowance. **Talk to admin** requests a handover immediately; unsupported questions, sensitive account issues and requests for account changes also go to an administrator. Automated replies stop once the conversation is queued or claimed. Users can continue adding messages while waiting. An admin claims the conversation in **Admin → Support inbox**, reads the earlier messages, replies and resolves it. Version checks prevent competing claims or replies based on an outdated thread. A resolved thread retains its history, and the user can start a new conversation.

Messages are text-only, limited to 2,000 characters, encrypted with `APP_KEY` and immutable after sending. Owners access their own chats; administrators access the support inbox. Message bodies are excluded from the general audit feed. Retries reuse a request key to avoid duplicate messages. Both sides refresh every six seconds while the widget or support inbox is open and the page is visible. Unsent drafts stay in memory; signing out or changing accounts clears private chat content. Chat rate limits are separate from financial actions. The static preview disables private chat requests.

The **Built-in account assistant** runs entirely inside Laravel. Local question matching identifies supported topics, and the application fills the answer from the signed-in user's current records. It uses no external AI service, provider credentials or model downloads. Unknown questions pass directly to the admin queue. Neither questions nor account information leave the application for automated processing.

## Identity verification

Users open `/app#verification` and enter their legal name, date of birth, country, residential address, document type and number. They must be at least 18 and consent to private administrator review. The ID upload accepts JPG, PNG or PDF; the selfie accepts JPG or PNG. Each file is limited to 2 MB to match the local PHP upload limit.

Submissions progress through **not submitted → pending → approved/rejected**. Rejected users see the administrator's reason and can submit a new set of details and documents. Submitted details cannot be overwritten. Final reviews are immutable and audited; concurrent or repeated requests cannot reverse a decision.

Open **Admin → Identity verification → Requirements & users** to configure verification:

1. Edit **Why KYC is required**, the explanation shown on every signed-in user's verification page.
2. Add reusable verification layers with a name, explanation and input fields. Fields support short answers, long answers, dates, dropdowns, confirmations and private JPG/PNG/PDF uploads. Mark each input required or optional, then save the requirements library.
3. Search for a user, select the layers that apply to that account, optionally write an individual explanation, and choose **Apply to this user**. Different users can receive different combinations of layers.

The library supports up to eight layers with twelve fields per layer. Each upload is limited to 2 MB; all documents in a submission together must fit within 6 MB, and assignments can include at most eighteen additional file inputs. These bounds fit the local PHP upload settings. Select fields accept up to thirty distinct choices.

Each user assignment saves the questions as a snapshot. Editing or removing a library template does not silently change assigned forms. Reapply the user's assignment to use edited templates. A changed assignment puts prior submissions into **additional checks required**, blocks new withdrawals, and lets the user submit the complete current form for a fresh admin review. Historical identity details, answers, documents and decisions remain intact; an outdated submission cannot approve newer requirements. Changing the general explanation alone does not invalidate verification. Concurrent admin edits and stale user forms return a conflict and require a refresh.

Approved KYC is enforced on the server before a new withdrawal request or reservation can be created. Existing withdrawal requests can still be reviewed or retried, and deposits, staking, and copy positions continue to work. Existing accounts were not automatically approved, and no identity documents were added to the local database during setup.

Identity fields, custom answers, submission snapshots, individual assignment reasons and stored document metadata are encrypted with `APP_KEY`. Files are encrypted on the dedicated private `kyc` disk under `storage/app/kyc`, outside the public storage link; `KYC_STORAGE_PATH` can select another private root. Only the owner or an administrator can download a document through an authenticated endpoint. Files are sent as attachments with no-store and nosniff headers. Identity details, document paths, and private reasons are excluded from general audit feeds; sensitive admin details clear when closing a review, leaving the tab, signing out, or losing access. Back up the private documents, database, and encryption key together if retaining uploaded submissions.

This is a manual administrator review workflow. The static preview disables identity uploads and review actions.

## Payment settings and Stripe setup

Open **Admin → Payment Settings**. Enter your current administrator password to save a change. The page lets you configure Stripe mode, publishable key, secret key, and webhook signing secret, plus manual bank name, account holder, account number, instructions, reference label, and support contact. Secret inputs are write-only: leave them blank to keep the saved values. Credentials and bank configuration are encrypted in the database with `APP_KEY`; do not replace that key without migrating encrypted data. Settings changes record field names in the audit trail rather than credential values.

Stripe is disabled by default and defaults to **test** mode. No Stripe keys have been added to this workspace, and no real card charge has been made. Stripe's [prohibited-business policy](https://stripe.com/legal/restricted-businesses) lists gambling and sports forecasting/odds-making with prizes. This integration does not establish eligibility for this staking platform; confirm support directly with Stripe before any live use. Production rejects test-mode checkout and sandbox wallet credit.

For local integration testing with your own test account:

1. Add the matching `pk_test_...` and `sk_test_...` keys in Payment Settings.
2. Use Stripe CLI forwarding for the local webhook:

   ```sh
   stripe listen --forward-to http://127.0.0.1:8135/api/payments/stripe/webhook
   ```

3. Save the listener's `whsec_...` signing secret and enable Stripe. The secret from a CLI listener differs from a Dashboard endpoint secret.
4. Deposit using **Card via Stripe**, then continue to the hosted checkout. The return page polls the verified payment state; the redirect itself never credits the wallet.

For an eligible live deployment, use the Dashboard's HTTPS webhook endpoint and its signing secret. Supported events are `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, and `checkout.session.expired`. A paid event must match the stored session, user, reference, mode, amount, currency, and payment intent. Signed retries, duplicate event IDs, and distinct events for the same paid session cannot double-credit a wallet. Previous signing secrets remain valid for a 24-hour rotation period.

Stripe deposits accept $100–$999,999.99; manual deposits accept $100–$1,000,000. An ambiguous network request reuses its original provider idempotency key. After the retry window expires, reconcile the payment with Stripe rather than creating another charge for the same request.

Manual deposits remain available for users who cannot use Stripe. Their destination details are saved with each request so later settings changes do not alter the transfer instructions being reviewed. Disabling manual deposits does not block withdrawals or the review of existing requests.

Expired pending credential snapshots and signing-key rotation copies are pruned by `php artisan edge:payments-prune-secrets`, scheduled hourly. Run Laravel's scheduler in a deployed environment; the command never deletes payment or wallet records.

## Custom manual payment methods

Open **Admin → Payment settings → More ways to move → Add payment method**. Upload a JPG, PNG or WebP image up to 1 MB (maximum 2400 × 2400 pixels), enter the method name and payment details/instructions, then enable it for deposits, withdrawals, or both. Confirm saves with your current administrator password. Images are served through the authenticated application and stored encrypted alongside method configuration. No external image URLs or public storage link are needed.

For withdrawals, add the recipient fields users must complete. Up to twelve fields are supported: short text, long text, email and dropdowns, with labels, optional help text, required/optional settings and 2–20 dropdown choices. Account numbers and addresses use text so leading zeros and international formats are preserved. Edit a method to change its image, instructions or fields, or uncheck **Enabled** to stop new requests. Version checks reject stale admin saves.

Once the first method is created, the catalog controls both manual deposit and withdrawal availability. The original bank configuration remains the fallback only while the catalog is empty. If no enabled method supports a direction, that action is unavailable; callers cannot bypass the catalog through the older bank API. Stripe remains independent of the manual catalog.

Users choose a method in the wallet dialog and see its image and instructions. Deposits require a payment reference and remain pending until an admin verifies receipt. Withdrawals use the selected method's fields, retain the approved-KYC and $100 minimum rules, and reserve funds immediately. An admin completes the external payout before approving it; rejection refunds the reservation. The app does not initiate transfers through these manual methods.

Every request saves an encrypted snapshot of the method's name, instructions, version, field definitions and recipient answers. Admins see the original labels and values in **Payment requests → Review request**, even after a method is renamed, edited or disabled. User history is owner-only, and general audit summaries exclude these custom recipient details. Retries return the original request without a second credit or reservation, including after the method changes. New submissions based on an old definition require reopening the form.

The local migration adds the catalog and encrypted request details without changing existing payment requests, methods, balances or Stripe credentials. No payment methods or financial requests are created by setup.

## Accounting and access

Wallets, stakes, copy capital, and new Stripe checkouts use **US dollars (USD)**. Existing local test amounts were kept numerically unchanged by request; no exchange rate was applied. A private SQLite backup was made before the switch. The migration preserves the previous denomination for an existing funded database until an explicit, audited local test-funds switch runs:

```sh
php artisan migrate --force
php artisan edge:currency-usd --keep-amounts --admin=your-admin@example.com
```

The switch is limited to local/testing environments and refuses live Stripe payment history. It preserves historical Stripe currencies, and a payment in a previous currency cannot credit a USD wallet. Fresh installations initialize USD automatically.

Amounts use integer cents and accepted odds use four decimal places. Payout calculations use BCMath and round down once to the nearest cent. Ledger and audit records are immutable through the application. Writes run in transactions with user/event locks; SQLite also acquires a write mutex before reading financial state. Idempotency keys and unique settlement references prevent duplicate debit/credit effects. Sessions use CSRF protection, passwords are hashed, admin access is enforced server-side, and account records are scoped to their owner.

A pending copied stake is reserved within its position; the API exposes available funds, reserved funds, and their combined equity. A position cannot close while a copied stake is pending.

## Verification

```sh
php scripts/check-staking.php
php scripts/check-copy-performance.php
php scripts/check-currency.php
python3 scripts/check-api.py
python3 scripts/check-kyc-api.py
php scripts/check-kyc-layers.php
python3 scripts/check-kyc-layers-api.py
php scripts/check-support.php
python3 scripts/check-support-api.py
php scripts/check-promo.php
python3 scripts/check-promo-api.py
php scripts/check-payments.php
python3 scripts/check-payment-api.py
python3 scripts/check-manual-methods-api.py
npm run check
npm run build
```

The domain suite passes 86 real database checks, including concurrent competing spends, duplicate stakes, duplicate result settlement, withdrawal refunds, and copy returns. Copy performance passes 39 additional database checks covering real settlements, exact payouts, pending reservations, refunds, result ordering, and retained history after closure. The API suite passes 76 HTTP checks using a disposable database and real session cookies/CSRF, including landing/platform routing and the copy chart's funding-to-settlement flow. It starts and stops its own temporary local server. KYC passes 218 HTTP checks covering multipart validation, private encrypted files, record ownership, review transitions, and the withdrawal guard, using synthetic identities in isolated storage. Layered KYC adds 137 database/service checks and 122 HTTP checks covering individual assignments, custom answers and files, concurrent admin saves, versioned history and re-verification. Support passes 494 service/database checks and 139 HTTP checks covering owner-only chats, accurate account answers, encrypted history, handoff, competing admin actions, idempotency, bounded history, and zero external HTTP requests. Promotional credits pass 193 database/service checks and 164 HTTP checks covering authorization, secret masking, single-use redemption, issuance retries, racing claims/revocation, real staking and copy allocation, and KYC-gated withdrawals. Currency migration and explicit test-funds switching pass 42 checks. Payment services pass 131 checks with Stripe HTTP simulated, and payment APIs pass 450 HTTP assertions.

Optional DOM integration suites use jsdom installed outside the project:

```sh
npm install --prefix /tmp/edge-dom-qa jsdom@26
EDGE_JSDOM_PATH=/tmp/edge-dom-qa/node_modules/jsdom node scripts/check-server-ui.cjs
EDGE_JSDOM_PATH=/tmp/edge-dom-qa/node_modules/jsdom node scripts/check-copy-performance-ui.cjs
EDGE_JSDOM_PATH=/tmp/edge-dom-qa/node_modules/jsdom node scripts/check-landing-motion.cjs
EDGE_JSDOM_PATH=/tmp/edge-dom-qa/node_modules/jsdom node scripts/check-kyc-ui.cjs
EDGE_JSDOM_PATH=/tmp/edge-dom-qa/node_modules/jsdom node scripts/check-kyc-layers-ui.cjs
EDGE_JSDOM_PATH=/tmp/edge-dom-qa/node_modules/jsdom node scripts/check-support-ui.cjs
EDGE_JSDOM_PATH=/tmp/edge-dom-qa/node_modules/jsdom node scripts/check-promo-ui.cjs
EDGE_JSDOM_PATH=/tmp/edge-dom-qa/node_modules/jsdom node scripts/check-admin-ui.cjs
EDGE_JSDOM_PATH=/tmp/edge-dom-qa/node_modules/jsdom node scripts/check-payment-admin-ui.cjs
EDGE_JSDOM_PATH=/tmp/edge-dom-qa/node_modules/jsdom node scripts/check-manual-methods-ui.cjs
EDGE_JSDOM_PATH=/tmp/edge-dom-qa/node_modules/jsdom node scripts/check-ui.cjs
EDGE_JSDOM_PATH=/tmp/edge-dom-qa/node_modules/jsdom node scripts/check-copy-ui.cjs
```

Server UI: 38 checks. Promotional credit UI: 24 checks covering redemption, issuance retries, revocation, secret cleanup, validation and focus handling. Support UI: 22 checks covering the built-in assistant, two-way messages, retries, handover, history ordering, admin takeover, and private state cleanup. KYC UI: 32 scenarios covering user uploads/status, admin review, document privacy, account changes and focus handling. Layered KYC UI: 21 scenarios covering the form builder, per-user assignments, reasons, custom uploads, stale forms, conflicts and private state cleanup during asynchronous requests. Landing and motion: 19 checks covering navigation, illustrative chart interaction, no-JS access, loading/error recovery, account links, duplicate submits, and pending-form preservation. Copy performance UI: 19 scenarios, including the line rising on wins, falling on losses, and remaining flat on refunds, plus accessible point inspection and complete game history. Admin UI: 18 checks. Payment Settings UI: 21 checks. Custom manual methods: 114 HTTP checks and 14 admin UI checks covering image uploads, directions, field definitions, private snapshots, stale versions, approval/refund accounting and state cleanup. Payment service tests use isolated SQLite and mocked Stripe HTTP; payment API tests block all outbound provider requests. These tests verify payment handling without making live charges. The two older suites cover the retained browser-only static preview. Browser visual inspection remains unavailable because the supplied browser connection fails during initialization.

## Source and preview

- `app/Services/` — staking, wallet, copy, settlement, and transaction logic.
- `app/Http/Controllers/` — authenticated APIs and explicit response objects.
- `database/migrations/`, `database/seeders/` — schema and fictional sample data.
- `resources/views/landing.blade.php`, `public/assets/landing.css`, `landing.js` — public landing page.
- `resources/views/app.blade.php`, `resources/views/partials/admin.blade.php` — customer and admin interface.
- `public/assets/server-app.js`, `admin.js` — API-backed interfaces.
- `public/assets/kyc.js`, `kyc.css`, `resources/views/partials/kyc.blade.php` — identity submission, status and private admin review.
- `public/assets/support.js`, `support.css`, `resources/views/partials/support.blade.php` — private support widget and administrator inbox.
- `public/assets/promo.js`, `promo.css`, `resources/views/partials/promo.blade.php` — credit-code issuance, revocation and wallet redemption.
- `public/assets/manual-methods.js`, `manual-methods.css`, `resources/views/partials/manual-methods.blade.php` — admin payment-method editor and withdrawal field builder.
- `public/assets/motion.js`, `motion.css` — shared loaders, request feedback, and reduced-motion-aware effects.
- `public/assets/app.js` — retained static demo, skipped when Laravel renders the page.

`npm run build` generates the landing page in `dist/index.html` and static platform/admin previews in `dist/app/` and `dist/admin/`. `npm run preview` serves them on port 8080. It does not run the Laravel backend, and its admin page is read-only. Use `php artisan serve` to test the full system. See [ASSET_CREDITS.md](ASSET_CREDITS.md) for asset credits.
