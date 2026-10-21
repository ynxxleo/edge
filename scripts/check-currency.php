<?php

/** Currency migration checks against disposable databases; no configured funds are touched. */
require __DIR__.'/../vendor/autoload.php';

use App\Models\AdminAudit;
use App\Models\PaymentSetting;
use App\Models\User;
use App\Services\PaymentSettingsService;
use App\Services\StakingCurrency;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

$paths = [];
try {
    $app = require __DIR__.'/../bootstrap/app.php';
    $app->make(Kernel::class)->bootstrap();
    $app['env'] = 'testing';
    config(['database.default' => 'sqlite', 'cache.default' => 'array']);
    $count = 0;
    $check = function (bool $condition, string $message) use (&$count): void {
        if (! $condition) {
            throw new RuntimeException('FAILED: '.$message);
        }
        $count++;
    };
    $currencyPath = 'database/migrations/2026_10_17_000002_use_usd_wallet_currency.php';
    $oldMigrations = array_values(array_filter(array_map(fn ($path) => 'database/migrations/'.basename($path), glob(__DIR__.'/../database/migrations/*.php')), fn ($path) => $path !== $currencyPath));
    $tables = ['users', 'wallet_transactions', 'wallet_requests', 'bets', 'bet_selections', 'copy_positions', 'copy_stakes', 'stripe_payments'];
    $snapshot = fn () => array_map(fn ($table) => DB::table($table)->orderBy('id')->get()->toJson(), $tables);

    foreach (['empty', 'zero_member', 'stripe_history', 'wallet_balance', 'wallet_transactions', 'wallet_requests', 'bets', 'copy_positions', 'copy_stakes'] as $scenario) {
        $path = tempnam(sys_get_temp_dir(), 'edge-currency-');
        $paths[] = $path;
        config(['database.connections.sqlite.database' => $path]);
        DB::purge('sqlite');
        Artisan::call('migrate', ['--path' => $oldMigrations, '--force' => true]);
        if ($scenario !== 'empty') {
            $admin = User::create(['name' => 'Currency administrator', 'email' => 'currency-admin@test.invalid', 'password' => 'CurrencyTestPassword123']);
            $admin->is_admin = true;
            $admin->save();
            $user = User::create(['name' => 'Currency member', 'email' => 'currency-member@test.invalid', 'password' => 'CurrencyTestPassword123']);
        }
        $now = now();
        if ($scenario === 'wallet_balance') {
            DB::table('users')->where('id', $user->id)->update(['wallet_balance' => 100055]);
        } elseif ($scenario === 'wallet_transactions') {
            DB::table('wallet_transactions')->insert(['user_id' => $user->id, 'reference' => 'legacy-ledger', 'type' => 'withdrawal', 'amount' => -20000, 'balance_after' => 0, 'created_at' => $now, 'updated_at' => $now]);
        } elseif ($scenario === 'wallet_requests') {
            DB::table('wallet_requests')->insert(['user_id' => $user->id, 'reference' => 'legacy-request', 'request_hash' => str_repeat('a', 64), 'type' => 'deposit', 'amount' => 20055, 'method' => 'bank_transfer', 'status' => 'pending', 'created_at' => $now, 'updated_at' => $now]);
        } elseif ($scenario === 'bets') {
            DB::table('bets')->insert(['user_id' => $user->id, 'reference' => 'legacy-bet', 'request_hash' => str_repeat('b', 64), 'type' => 'single', 'stake' => 1234, 'status' => 'pending', 'payout' => 0, 'created_at' => $now, 'updated_at' => $now]);
        } elseif (in_array($scenario, ['copy_positions', 'copy_stakes'], true)) {
            $strategy = DB::table('copy_strategies')->insertGetId(['name' => 'Legacy strategy', 'slug' => 'legacy', 'sport' => 'football', 'description' => 'Currency test fixture', 'stake_percentage' => 10, 'active' => true, 'created_at' => $now, 'updated_at' => $now]);
            $position = DB::table('copy_positions')->insertGetId(['user_id' => $user->id, 'copy_strategy_id' => $strategy, 'funding_reference' => 'legacy-copy', 'principal' => 100055, 'value' => 87500, 'profit' => -12555, 'status' => 'active', 'created_at' => $now, 'updated_at' => $now]);
            if ($scenario === 'copy_stakes') {
                $event = DB::table('sport_events')->insertGetId(['sport' => 'football', 'league' => 'Currency fixture', 'home_name' => 'Home', 'away_name' => 'Away', 'starts_at' => now()->addHour(), 'status' => 'open', 'odds_home' => 2.5, 'odds_away' => 2.5, 'created_at' => $now, 'updated_at' => $now]);
                $pick = DB::table('copy_picks')->insertGetId(['copy_strategy_id' => $strategy, 'sport_event_id' => $event, 'outcome' => 'home', 'odds' => 2.5, 'published_by' => $admin->id, 'created_at' => $now, 'updated_at' => $now]);
                DB::table('copy_stakes')->insert(['copy_position_id' => $position, 'copy_pick_id' => $pick, 'stake' => 5000, 'odds' => 2.5, 'status' => 'pending', 'payout' => 0, 'created_at' => $now, 'updated_at' => $now]);
            }
        }
        if (in_array($scenario, ['stripe_history', 'copy_stakes'], true)) {
            DB::table('stripe_payments')->insert(['user_id' => $user->id, 'reference' => 'legacy-stripe', 'request_hash' => str_repeat('c', 64), 'amount' => 30025, 'currency' => 'NGN', 'mode' => 'test', 'status' => 'pending', 'session_id' => 'cs_test_LegacyCurrency', 'created_at' => $now, 'updated_at' => $now]);
        }
        $before = $snapshot();
        Artisan::call('migrate', ['--path' => [$currencyPath], '--force' => true]);
        $expected = in_array($scenario, ['empty', 'zero_member', 'stripe_history'], true) ? 'USD' : 'NGN';
        $check(StakingCurrency::code() === $expected, $scenario.' migration retains untagged historical funds or initializes a clean USD wallet');
        $check(app(PaymentSettingsService::class)->publicMethods()['currency'] === $expected, $scenario.' methods publish the authoritative wallet denomination');
        $check($snapshot() === $before, $scenario.' migration does not rewrite any financial row or stored Stripe currency');
    }

    // Exercise command preservation with nonzero cash, signed ledger movements,
    // a reserved withdrawal, a pending bet and a copied stake in the same account.
    \App\Models\KycSubmission::create(['user_id' => $user->id, 'status' => 'approved', 'version' => 2, 'consented_at' => now(), 'reviewed_by' => $admin->id, 'reviewed_at' => now()]);
    app(\App\Services\WalletService::class)->credit($user, 543210, 'deposit', 'legacy-test-wallet');
    app(\App\Services\WalletRequestService::class)->create($user, 'withdrawal', 20055, 'bank_transfer', ['bank_name' => 'Fixture Bank', 'account_number' => '0123456789'], 'currency-pending-withdrawal');
    $fixtureEvent = \App\Models\SportEvent::findOrFail($event);
    app(\App\Services\BettingService::class)->place($user, [['event_id' => $fixtureEvent->id, 'outcome' => 'home', 'expected_odds' => $fixtureEvent->odds_home, 'expected_version' => $fixtureEvent->version]], 1234, 'single', 'currency-pending-bet');
    $check($user->fresh()->wallet_balance === 521921 && DB::table('wallet_transactions')->count() === 3, 'command fixture has nonzero available cash and actual reserved withdrawals and bets');

    // The copy allocation and historical NGN Stripe record must also remain
    // byte-for-byte intact across the explicit test-funds redenomination.
    $command = fn (array $options = []) => Artisan::call('edge:currency-usd', $options);
    $options = ['--keep-amounts' => true, '--admin' => $admin->email];
    $before = $snapshot();
    $check($command(['--admin' => $admin->email]) !== 0 && StakingCurrency::code() === 'NGN', 'keeping numeric test funds requires an explicit command option');
    $check($command(['--keep-amounts' => true]) !== 0, 'currency change requires an identified administrator');
    $check($command(['--keep-amounts' => true, '--admin' => $user->email]) !== 0, 'a member cannot authorize a currency change');
    $app['env'] = 'production';
    $check($command($options) !== 0 && StakingCurrency::code() === 'NGN', 'local test redenomination is blocked in production');
    $app['env'] = 'testing';
    DB::table('stripe_payments')->where('reference', 'legacy-stripe')->update(['mode' => 'live']);
    $check($command($options) !== 0 && StakingCurrency::code() === 'NGN', 'any live Stripe history blocks the local test-funds command');
    DB::table('stripe_payments')->where('reference', 'legacy-stripe')->update(['mode' => 'test']);
    $check($snapshot() === $before && AdminAudit::where('action', 'wallet.currency_changed')->doesntExist(), 'failed currency changes preserve financial rows and produce no success audit');
    $oldVersion = PaymentSetting::findOrFail(1)->version;
    $check($command($options) === 0 && StakingCurrency::code() === 'USD', 'explicit authorized local change selects USD');
    $check($snapshot() === $before, 'local test redenomination preserves balances, copy capital, P/L, reservations and historical Stripe currency');
    $check(PaymentSetting::findOrFail(1)->version === $oldVersion + 1, 'successful currency change increments settings version once');
    $audit = AdminAudit::where('action', 'wallet.currency_changed')->sole();
    $check($audit->actor_id === $admin->id && $audit->before['currency'] === 'NGN' && $audit->after['currency'] === 'USD', 'audit identifies the administrator and old/new wallet currencies');
    $check($audit->after['monetary_values_unchanged'] === true && $audit->after['stripe_history_currencies_unchanged'] === true, 'audit records the approved numeric and history preservation');
    $check($command($options) === 0 && PaymentSetting::findOrFail(1)->version === $oldVersion + 1 && AdminAudit::where('action', 'wallet.currency_changed')->count() === 1, 'rerunning the USD change is an idempotent no-op');
    $currencyMigration = require __DIR__.'/../'.$currencyPath;
    try {
        $currencyMigration->down();
        $check(false, 'funded USD metadata cannot be rolled back');
    } catch (RuntimeException $exception) {
        $check(str_contains($exception->getMessage(), 'Cannot remove USD'), 'funded USD metadata cannot be rolled back');
    }
    $check(Schema::hasColumn('payment_settings', 'wallet_currency') && StakingCurrency::code() === 'USD' && $snapshot() === $before, 'blocked rollback keeps USD metadata and all financial history intact');
    echo "PASS: {$count} currency migration and command checks (isolated SQLite).\n";
} finally {
    DB::disconnect('sqlite');
    foreach ($paths as $path) {
        @unlink($path);
        @unlink($path.'-wal');
        @unlink($path.'-shm');
    }
}
