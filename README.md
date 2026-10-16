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

All balances, transactions, stakes, and profits are illustrative and stored in this browser’s `localStorage` under `edge-demo-v1`. Fixtures and odds are sample data. Deposits and withdrawals update virtual funds only: there is no payment processor, bank transfer, authentication service, live odds feed, or server-side financial ledger. Do not use real bank details in the preview.

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
```

The suite passes 39 checks. Browser layout verification could not run because the supplied browser connection failed during initialization.
