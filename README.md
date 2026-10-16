# EDGE — Laravel sports & games UI

A responsive Laravel 13 / Blade interface inspired by the reference image’s oversized typography, technical details, dark surfaces, and bright green accents. PHP 8.3+ and Composer are required. Assets are served directly from `public/assets`; no frontend dependencies or Vite process are needed.

## Run Laravel

```sh
composer install --no-dev
cp .env.example .env
php artisan key:generate
php artisan serve --host=127.0.0.1 --port=8000
```

Open http://127.0.0.1:8000. Dependencies and a local `.env` have already been prepared in this workspace, so `php artisan serve` is enough here. Sessions and cache use files, and the queue runs synchronously. A database is not needed to use the UI.

## Explore the demo

- Browse sample sports, filter events, search teams, and add odds to a single or multiple bet slip.
- Place a virtual stake, inspect active bets, and cash out a demo stake into the available wallet balance.
- Deposit demo funds and withdraw available funds, including demo profit, using the wallet modal.
- View and filter wallet transactions. Reset the starting wallet from the account menu.
- Play the free arcade games without staking wallet funds.
- Use Copy Staking (`#copy`) to browse three sample strategies, deposit directly into an allocation or fund it from your available wallet, and track separate copy positions.
- Add funds, pause/resume copying, preview explicit simulated rounds, or close a position and return its value to the wallet for withdrawal.

All balances, transactions, stakes, and profits are illustrative and stored in this browser’s `localStorage` under `edge-demo-v1`. Fixtures and odds are sample data. Deposits and withdrawals update virtual funds only: there is no payment processor, bank transfer, authentication service, live odds feed, or server-side financial ledger. Do not use real bank details in the preview.

Copy allocations have a ₦5,000 minimum and a ₦1,000,000 limit per funding transaction. A new demo deposit records a deposit and a matching allocation, preserving the existing available wallet balance. Funds remain separate from the available wallet until the position is closed. Simulated rounds can win or lose; their profit or loss changes the position value. Closing a position returns that value once without counting its profit twice. Existing saved demo wallets are preserved when copy-position storage is added.

## Static preview

```sh
npm run build
npm run preview
```

Open http://127.0.0.1:8080. `scripts/build-preview.mjs` packages the same Blade markup and local assets into `dist/` for a static UI preview. This preview has the same browser-local demo behavior; the Laravel application remains the PHP source implementation.

## Files

- `resources/views/app.blade.php` — application layout and dialogs.
- `public/assets/app.css` — responsive interface styles.
- `public/assets/app.js` — browser-local interactions and demo wallet state.
- `routes/web.php` — Laravel page route; `/up` is the framework health route.
- `bootstrap/app.php`, `config/`, `app/` — Laravel application foundation.

See [ASSET_CREDITS.md](ASSET_CREDITS.md) for image and font credits.

## Verification

`npm run check` checks JavaScript syntax. The optional DOM integration suite covers demo-wallet accounting, form validation, stakes, cash outs, navigation, filters, games and persistence:

```sh
npm install --prefix /tmp/edge-dom-qa jsdom@26
EDGE_JSDOM_PATH=/tmp/edge-dom-qa/node_modules/jsdom node scripts/check-ui.cjs
EDGE_JSDOM_PATH=/tmp/edge-dom-qa/node_modules/jsdom node scripts/check-copy-ui.cjs
```

The suites pass 73 checks (39 core UI checks and 34 copy staking checks). Browser layout verification could not run because the supplied browser connection failed during initialization.
