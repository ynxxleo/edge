<?php

/** Copy performance is derived from real settlements in a temporary database. */
require __DIR__.'/../vendor/autoload.php';

use App\Http\Controllers\StakingData;
use App\Models\CopyPosition;
use App\Models\CopyStake;
use App\Models\CopyStrategy;
use App\Models\SportEvent;
use App\Models\User;
use App\Services\CopyService;
use App\Services\EventService;
use App\Services\SettlementService;
use App\Services\WalletService;
use Carbon\Carbon;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

$path = tempnam(sys_get_temp_dir(), 'edge-copy-performance-');
try {
    $app = require __DIR__.'/../bootstrap/app.php';
    $app->make(Kernel::class)->bootstrap();
    config(['database.default' => 'sqlite', 'database.connections.sqlite.database' => $path]);
    DB::purge('sqlite');
    Artisan::call('migrate', ['--force' => true]);
    Carbon::setTestNow(Carbon::parse('2032-07-10 12:00:00', 'UTC'));
    $count = 0;
    $check = function (bool $condition, string $message) use (&$count): void {
        if (! $condition) {
            throw new RuntimeException('FAILED: '.$message);
        }
        $count++;
    };
    $admin = User::create(['name' => 'Performance administrator', 'email' => 'admin@performance.invalid', 'password' => 'A-safe-test-password']);
    $admin->forceFill(['is_admin' => true])->save();
    $user = User::create(['name' => 'Copy investor', 'email' => 'member@performance.invalid', 'password' => 'A-safe-test-password']);
    $wallet = app(WalletService::class);
    $copy = app(CopyService::class);
    $events = app(EventService::class);
    $settlement = app(SettlementService::class);
    $wallet->credit($user, 2_000_000, 'deposit', 'performance-test-funding');
    $strategy = CopyStrategy::create(['slug' => 'performance-master', 'name' => 'Performance master', 'sport' => 'football', 'description' => 'Test', 'risk' => 'balanced', 'stake_percentage' => 10, 'active' => true]);
    $position = $copy->fund($user, $strategy, 100019, 'performance-fund-001');
    $snapshot = fn () => StakingData::position($position->fresh());
    $data = $snapshot();
    $performance = $data['performance'];
    $check($performance['initial_deposit_cents'] === 100019 && $performance['current_value_cents'] === 100019, 'capital begins at the actual funded amount');
    $check($performance['net_profit_cents'] === 0 && $performance['return_percentage'] === 0.0, 'unplayed position has zero return');
    $check(count($performance['points']) === 1 && $performance['points'][0]['type'] === 'deposit', 'new position has a real deposit baseline');
    $check($performance['points'][0]['change_cents'] === 100019 && $performance['points'][0]['stake_id'] === null, 'deposit point is separate from game results');
    $check($performance['games'] === [] && $performance['settled_stakes_count'] === 0, 'no fictional performance or games are added');
    $fixture = fn (string $name, string $odds = '2.0000') => $events->create([
        'sport' => 'football', 'league' => 'Performance tests', 'country' => 'Test',
        'home_name' => $name.' home', 'away_name' => $name.' away',
        'starts_at' => now()->addHour(), 'status' => 'open',
        'odds_home' => $odds, 'odds_draw' => '3.0000', 'odds_away' => '2.5000',
    ], $admin);
    $win = $fixture('First published', '1.3333');
    $loss = $fixture('First settled');
    $void = $fixture('Voided match');
    $pending = $fixture('Last settled');
    foreach ([$win, $loss, $void, $pending] as $event) {
        $copy->publishPick($strategy, $event, 'home', $admin);
    }
    $stakes = $position->stakes()->orderBy('id')->get();
    $data = $snapshot();
    $check($data['reserved_cents'] > 0 && $data['value_cents'] < 100019, 'pending stakes reserve real capital');
    $check($data['performance']['current_value_cents'] === 100019 && count($data['performance']['points']) === 1, 'reservations never appear as trading losses');
    $check(count($data['performance']['games']) === 4 && $data['performance']['settled_stakes_count'] === 0, 'pending master games are visible without settlements');
    $check(array_unique(array_column($data['performance']['games'], 'status')) === ['pending'], 'pending master games remain pending');
    $check(array_unique(array_column($data['performance']['games'], 'net_change_cents')) === [null], 'pending games have no realized change');
    $game = $data['performance']['games'][0];
    $check($game['home_name'] === 'Last settled home' && $game['away_name'] === 'Last settled away', 'games include both team names');

    Carbon::setTestNow(Carbon::parse('2032-07-10 15:00:00', 'UTC'));
    $settlement->settleEvent($loss, 0, 1, $admin);
    $data = $snapshot();
    $performance = $data['performance'];
    $check($performance['current_value_cents'] === 100019 - $stakes[1]->stake, 'a loss subtracts the full accepted stake');
    $check($performance['points'][1]['stake_id'] === $stakes[1]->id && $performance['points'][1]['change_cents'] === -$stakes[1]->stake, 'loss movement records the correct game and signed amount');
    $check($performance['current_value_cents'] === $data['equity_cents'], 'capital includes available funds and unresolved stakes');

    Carbon::setTestNow(Carbon::parse('2032-07-10 16:00:00', 'UTC'));
    $settlement->settleEvent($win, 2, 1, $admin);
    $won = $stakes[0]->fresh();
    $data = $snapshot();
    $performance = $data['performance'];
    $check($won->stake === 10001 && $won->payout === 13334, 'service payout is floored to whole minor units');
    $check($performance['points'][2]['change_cents'] === 3333, 'winning movement uses actual rounded payout minus stake');
    $check($performance['points'][1]['stake_id'] === $stakes[1]->id && $performance['points'][2]['stake_id'] === $stakes[0]->id, 'curve follows settlement order rather than publication order');
    $check($performance['current_value_cents'] === $data['equity_cents'] && $performance['net_profit_cents'] === $data['profit_cents'], 'curve reconciles with the settled account balances');

    Carbon::setTestNow(Carbon::parse('2032-07-10 17:00:00', 'UTC'));
    $events->void($void, $admin);
    $data = $snapshot();
    $performance = $data['performance'];
    $check($performance['points'][3]['status'] === 'void' && $performance['points'][3]['change_cents'] === 0, 'voided games show a zero change settlement');
    $check($performance['points'][3]['value_cents'] === $performance['points'][2]['value_cents'], 'returning a void stake does not fabricate profit');
    $check($performance['settled_stakes_count'] === 3 && count($performance['points']) === 4, 'one point is emitted for each settled game');
    $copy->changeStatus($position, 'paused');
    $paused = $snapshot();
    $check($paused['performance'] === $performance, 'pausing does not reset performance');
    try {
        $copy->close($position);
        $check(false, 'pending stakes block wallet return');
    } catch (ValidationException) {
        $check(true, 'pending stakes block wallet return');
    }

    Carbon::setTestNow(Carbon::parse('2032-07-10 18:00:00', 'UTC'));
    $settlement->settleEvent($pending, 1, 0, $admin);
    $beforeClose = $snapshot();
    $beforeWallet = $user->fresh()->wallet_balance;
    $copy->close($position);
    $closed = $snapshot();
    $check($closed['status'] === 'closed' && $closed['equity_cents'] === 0, 'closing still returns all capital to the wallet');
    $check($user->fresh()->wallet_balance === $beforeWallet + $beforeClose['equity_cents'], 'wallet return uses the actual final capital');
    $check($closed['performance'] === $beforeClose['performance'], 'closed charts retain final historical capital');
    $check($closed['performance']['current_value_cents'] === 101642 && $closed['performance']['net_profit_cents'] === 1623, 'combined wins losses and refunds produce exact final capital');
    $check($closed['performance']['return_percentage'] === 1.62, 'percentage return is rounded only for display');
    $check(array_column($closed['performance']['games'], 'status') === ['won', 'void', 'won', 'lost'], 'game history sorts newest settlement first');
    $check(array_column($closed['performance']['games'], 'net_change_cents') === [7291, 0, 3333, -9001], 'game history uses the same net changes as the chart');
    $settlement->settleEvent($pending, 1, 0, $admin);
    $check($snapshot()['performance'] === $closed['performance'], 'repeated final scores never duplicate performance points');
    $reverseLoaded = $position->fresh();
    $reverseLoaded->setRelation('stakes', $reverseLoaded->stakes()->orderByDesc('id')->get());
    $check(StakingData::position($reverseLoaded)['performance'] === $closed['performance'], 'performance is deterministic regardless of relation loading order');

    // Legacy/imported settled records may lack an explicit stake settlement time.
    DB::table('copy_stakes')->where('id', $stakes[0]->id)->update(['settled_at' => null]);
    $fallback = $snapshot()['performance'];
    $check($fallback === $closed['performance'], 'missing stake settlement time falls back to the game settlement time');
    DB::table('sport_events')->where('id', $win->id)->update(['settled_at' => null]);
    $check($snapshot()['performance'] === $closed['performance'], 'missing game settlement time falls back to the stake update time');
    DB::table('copy_stakes')->where('id', $stakes[1]->id)->update(['settled_at' => '2032-07-10 16:00:00']);
    $tied = $snapshot()['performance'];
    $check(array_column(array_slice($tied['points'], 1, 2), 'stake_id') === [$stakes[0]->id, $stakes[1]->id], 'same timestamp settlements are ordered by numeric stake ID');
    $check($tied['current_value_cents'] === $closed['performance']['current_value_cents'], 'settlement ordering cannot change final capital');
    DB::table('copy_stakes')->where('id', $stakes[0]->id)->update(['updated_at' => null]);
    $createdFallback = $snapshot()['performance']['points'][1];
    $check($createdFallback['stake_id'] === $stakes[0]->id && $createdFallback['recorded_at'] === $stakes[0]->created_at->toIso8601String(), 'legacy records fall back to creation time when necessary');

    // A fully lost position reaches zero without a division or scale error.
    Carbon::setTestNow(Carbon::parse('2032-07-11 12:00:00', 'UTC'));
    $allIn = CopyStrategy::create(['slug' => 'all-in-test', 'name' => 'Test master', 'sport' => 'football', 'description' => 'Test', 'risk' => 'high', 'stake_percentage' => 100, 'active' => true]);
    $zeroPosition = $copy->fund($user, $allIn, 10000, 'performance-zero-001');
    $zeroEvent = $fixture('Full loss');
    $copy->publishPick($allIn, $zeroEvent, 'home', $admin);
    Carbon::setTestNow(Carbon::parse('2032-07-11 14:00:00', 'UTC'));
    $settlement->settleEvent($zeroEvent, 0, 1, $admin);
    $zero = StakingData::position($zeroPosition->fresh())['performance'];
    $check($zero['current_value_cents'] === 0 && $zero['net_profit_cents'] === -10000 && $zero['return_percentage'] === -100.0, 'complete loss preserves a valid zero capital endpoint');
    $check(is_int($zero['points'][1]['value_cents']) && is_int($zero['points'][1]['change_cents']), 'all capital movements remain integer minor units');

    echo "PASS: {$count} copy performance database integration checks.\n";
} finally {
    Carbon::setTestNow();
    if (isset($app)) {
        DB::disconnect('sqlite');
    }
    @unlink($path);
}
