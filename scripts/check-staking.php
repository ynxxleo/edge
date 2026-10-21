<?php

/** Real database integration checks, isolated from the application's configured database. */
require __DIR__.'/../vendor/autoload.php';

use App\Models\AdminAudit;
use App\Models\Bet;
use App\Models\CopyPosition;
use App\Models\CopyStrategy;
use App\Models\CopyStake;
use App\Models\SportEvent;
use App\Models\User;
use App\Models\WalletRequest;
use App\Models\WalletTransaction;
use App\Services\BettingService;
use App\Services\CopyService;
use App\Services\EventService;
use App\Services\SettlementService;
use App\Services\StakingRules;
use App\Services\WalletRequestService;
use App\Services\WalletService;
use Carbon\Carbon;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

$path = tempnam(sys_get_temp_dir(), 'edge-staking-');
try {
    $app = require __DIR__.'/../bootstrap/app.php';
    $app->make(Kernel::class)->bootstrap();
    config(['database.default' => 'sqlite', 'database.connections.sqlite.database' => $path, 'database.connections.sqlite.transaction_mode' => 'IMMEDIATE', 'database.connections.sqlite.busy_timeout' => 5000]);
    DB::purge('sqlite');
    Artisan::call('migrate', ['--force' => true]);
    Carbon::setTestNow(Carbon::parse('2030-03-20 12:00:00', 'UTC'));
    $count = 0;
    $check = function (bool $condition, string $message) use (&$count): void {
        if (! $condition) {
            throw new RuntimeException('FAILED: '.$message);
        }
        $count++;
    };
    $reject = function (callable $action, string $message) use ($check): void {
        try {
            $action();
        } catch (ValidationException) {
            $check(true, $message);
            return;
        }
        $check(false, $message);
    };
    $admin = User::create(['name' => 'Test administrator', 'email' => 'admin@test.invalid', 'password' => 'A-safe-test-password']);
    $admin->is_admin = true;
    $admin->save();
    $user = User::create(['name' => 'Test member', 'email' => 'member@test.invalid', 'password' => 'A-safe-test-password']);
    // Synthetic approved identity keeps these financial regression fixtures focused on settlement.
    \App\Models\KycSubmission::create(['user_id' => $user->id, 'status' => 'approved', 'version' => 2, 'consented_at' => now(), 'reviewed_by' => $admin->id, 'reviewed_at' => now()]);
    $wallet = app(WalletService::class);
    $requests = app(WalletRequestService::class);
    $betting = app(BettingService::class);
    $events = app(EventService::class);
    $settlement = app(SettlementService::class);
    $copy = app(CopyService::class);
    $fixture = function (string $suffix, array $overrides = []) use ($events, $admin): SportEvent {
        return $events->create(array_replace([
            'sport' => 'football', 'league' => 'Integration tests', 'country' => 'Test', 'home_name' => 'Home '.$suffix,
            'away_name' => 'Away '.$suffix, 'starts_at' => now()->addHours(2), 'status' => 'open',
            'odds_home' => '2.5000', 'odds_draw' => '3.2000', 'odds_away' => '2.8000',
        ], $overrides), $admin);
    };
    $select = fn (SportEvent $event, string $outcome = 'home') => ['event_id' => $event->id, 'outcome' => $outcome, 'expected_odds' => $event->{'odds_'.$outcome}, 'expected_version' => $event->version];
    $finish = function (SportEvent $event, int $home, int $away) use ($settlement, $admin) {
        Carbon::setTestNow(now()->addHours(4));
        return $settlement->settleEvent($event, $home, $away, $admin);
    };

    // Funds are credited only after an auditable review. Withdrawals reserve funds immediately.
    $deposit = $requests->create($user, 'deposit', 1_000_000, 'Bank transfer', ['receipt' => 'TEST-RECEIPT-001'], 'deposit-key-001');
    $check($user->fresh()->wallet_balance === 0, 'unreviewed deposit does not fabricate funds');
    $requests->review($deposit, true, $admin, 'BANK-DEPOSIT-001');
    $check($user->fresh()->wallet_balance === 1_000_000, 'approved deposit credits wallet');
    $requests->review($deposit, true, $admin, 'BANK-DEPOSIT-001');
    $check($user->fresh()->wallet_balance === 1_000_000 && WalletTransaction::count() === 1, 'repeated deposit approval cannot double-credit');
    $reject(fn () => $requests->create($user, 'deposit', 200, 'Bank transfer', [], 'deposit-key-001'), 'request key cannot change its amount');
    $secondDeposit = $requests->create($user, 'deposit', 100, 'Bank transfer', [], 'deposit-key-002');
    $reject(fn () => $requests->review($secondDeposit, true, $admin, 'BANK-DEPOSIT-001'), 'bank receipt cannot fund two deposits');
    $withdrawal = $requests->create($user, 'withdrawal', 20000, 'Bank transfer', ['account' => '1234567890'], 'withdraw-key-001');
    $check($user->fresh()->wallet_balance === 980000, 'withdrawal immediately reserves funds');
    $requests->review($withdrawal, false, $admin);
    $requests->review($withdrawal, false, $admin);
    $check($user->fresh()->wallet_balance === 1000000, 'withdrawal rejection refunds once');
    $withdrawal2 = $requests->create($user, 'withdrawal', 10000, 'Bank transfer', [], 'withdraw-key-002');
    $requests->review($withdrawal2, true, $admin, 'BANK-WITHDRAW-002');
    $check($user->fresh()->wallet_balance === 990000, 'approved withdrawal does not debit twice');
    $reject(fn () => $requests->review($withdrawal2, false, $admin), 'review cannot be reversed after final decision');

    $event = $fixture('snapshot');
    $selection = $select($event);
    $before = $user->fresh()->wallet_balance;
    $bet = $betting->place($user, [$selection], 1000, 'single', 'bet-snapshot-001');
    $check($user->fresh()->wallet_balance === $before - 1000, 'bet reserves stake');
    $again = $betting->place($user, [$selection], 1000, 'single', 'bet-snapshot-001');
    $check($again->id === $bet->id && $user->fresh()->wallet_balance === $before - 1000, 'repeated placement returns same bet without debit');
    $reject(fn () => $betting->place($user, [$selection], 1100, 'single', 'bet-snapshot-001'), 'bet request key cannot change stake');
    $event = $events->update($event, ['odds_home' => '3.1000', 'version' => $event->version], $admin);
    $check($bet->selections()->first()->odds === '2.5000', 'accepted odds remain immutable after admin odds update');
    try {
        $bet->selections()->first()->update(['odds' => '9.0000']);
        $check(false, 'accepted selection model refuses an odds rewrite');
    } catch (LogicException) {
        $check(true, 'accepted selection model refuses an odds rewrite');
    }
    $reject(fn () => $betting->place($user, [$selection], 1000, 'single', 'bet-stale-001'), 'stale odds rejected without silently accepting change');
    $reject(fn () => $events->update($event, ['home_name' => 'Changed opponent', 'version' => $event->version], $admin), 'accepted game identity cannot change');
    $reject(fn () => $settlement->settleEvent($event, 2, 1, $admin), 'future games cannot settle');
    $finish($event, 2, 1);
    $check($bet->fresh()->status === 'won' && $bet->fresh()->payout === 2500, 'win settles at original accepted odds');
    $check($user->fresh()->wallet_balance === $before + 1500, 'winning gross payout includes original stake');
    $settlement->settleEvent($event, 2, 1, $admin);
    $check($user->fresh()->wallet_balance === $before + 1500, 'same score repeated cannot pay twice');
    $reject(fn () => $settlement->settleEvent($event, 0, 3, $admin), 'final result cannot be changed after settlement');
    $reject(fn () => $events->update($event, ['odds_home' => '4.0000'], $admin), 'finished game cannot reopen');

    $losingEvent = $fixture('loss');
    $loser = $betting->place($user, [$select($losingEvent)], 1000, 'single', 'bet-losing-001');
    $finish($losingEvent, 0, 1);
    $check($loser->fresh()->status === 'lost' && $loser->fresh()->payout === 0, 'loss has no payout');
    $drawEvent = $fixture('draw');
    $draw = $betting->place($user, [$select($drawEvent, 'draw')], 1000, 'single', 'bet-draw-001');
    $reject(fn () => $events->update($drawEvent, ['odds_draw' => null, 'version' => $drawEvent->version], $admin), 'draw market cannot be removed after accepting a bet');
    $updatedDraw = $events->update($drawEvent, ['odds_draw' => '3.7000', 'version' => $drawEvent->version], $admin);
    $check($updatedDraw->odds_draw === '3.7000' && $draw->selections()->first()->odds === '3.2000', 'existing draw quote may change while accepted draw odds remain fixed');
    $finish($drawEvent, 1, 1);
    $check($draw->fresh()->status === 'won' && $draw->fresh()->payout === 3200, 'final draw settles the original three-way market at accepted odds');
    $voidEvent = $fixture('void');
    $voidBet = $betting->place($user, [$select($voidEvent)], 1000, 'single', 'bet-void-001');
    $beforeVoid = $user->fresh()->wallet_balance;
    $events->void($voidEvent, $admin);
    $events->void($voidEvent, $admin);
    $check($voidBet->fresh()->status === 'void' && $user->fresh()->wallet_balance === $beforeVoid + 1000, 'void refunds exactly original stake once');

    $one = $fixture('multi-one');
    $two = $fixture('multi-two', ['odds_home' => '1.9000']);
    $multiple = $betting->place($user, [$select($one), $select($two)], 1001, 'multiple', 'bet-multiple-001');
    $beforeMulti = $user->fresh()->wallet_balance;
    $finish($one, 2, 0);
    $check($multiple->fresh()->status === 'pending' && $user->fresh()->wallet_balance === $beforeMulti, 'multiple does not pay until all legs resolve');
    $finish($two, 1, 0);
    $check($multiple->fresh()->payout === 4754, 'multiple multiplies accepted odds and rounds once to cents');
    $three = $fixture('multi-void-one');
    $four = $fixture('multi-void-two');
    $mixed = $betting->place($user, [$select($three), $select($four)], 1000, 'multiple', 'bet-mixedvoid-001');
    $events->void($three, $admin);
    $finish($four, 2, 0);
    $check($mixed->fresh()->payout === 2500, 'void leg contributes odds one to a winning multiple');
    $five = $fixture('allvoid-one');
    $six = $fixture('allvoid-two');
    $allVoid = $betting->place($user, [$select($five), $select($six)], 1000, 'multiple', 'bet-allvoid-001');
    $events->void($five, $admin);
    $events->void($six, $admin);
    $check($allVoid->fresh()->status === 'void' && $allVoid->fresh()->payout === 1000, 'all void multiple refunds stake');
    $seven = $fixture('earlyloss-one');
    $eight = $fixture('earlyloss-two');
    $earlyLoss = $betting->place($user, [$select($seven), $select($eight)], 1000, 'multiple', 'bet-earlyloss-001');
    $finish($seven, 0, 1);
    $check($earlyLoss->fresh()->status === 'lost', 'multiple may settle loss as soon as one leg loses');
    $finish($eight, 1, 0);
    $check($earlyLoss->fresh()->status === 'lost' && $earlyLoss->fresh()->payout === 0, 'remaining multiple leg cannot revive a lost bet');
    $twoWay = $fixture('two-way', ['sport' => 'basketball', 'odds_draw' => null]);
    $betting->place($user, [$select($twoWay)], 1000, 'single', 'bet-twoway-001');
    $reject(fn () => $events->update($twoWay, ['odds_draw' => '5.0000', 'version' => $twoWay->version], $admin), 'draw market cannot be added after accepting a two-way bet');
    $invalid = $fixture('validation');
    $reject(fn () => $betting->place($user, [$select($invalid), $select($invalid)], 1000, 'multiple', 'duplicate-event-001'), 'duplicate game in multiple rejected');
    $reject(fn () => $betting->place($user, [$select($invalid)], 100000000, 'single', 'overdrawn-bet-001'), 'insufficient balance rejects stake');
    $check(Bet::where('reference', StakingRules::reference('bet', $user, 'overdrawn-bet-001'))->count() === 0, 'failed stake transaction rolls back bet record');
    $suspended = $events->update($invalid, ['status' => 'suspended', 'version' => $invalid->version], $admin);
    $reject(fn () => $betting->place($user, [$select($suspended)], 1000, 'single', 'suspended-bet-001'), 'suspended games cannot accept new stakes');

    $strategy = CopyStrategy::create(['slug' => 'test-copy', 'name' => 'Test method', 'sport' => 'football', 'description' => 'Integration test strategy', 'risk' => 'balanced', 'stake_percentage' => 10, 'active' => true]);
    $copyEvent = $fixture('copy-win');
    $beforeFunding = $user->fresh()->wallet_balance;
    $position = $copy->fund($user, $strategy, 100000, 'copy-fund-001');
    $check($position->value === 100000 && $user->fresh()->wallet_balance === $beforeFunding - 100000, 'copy funding transfers existing wallet funds');
    $samePosition = $copy->fund($user, $strategy, 100000, 'copy-fund-001');
    $check($samePosition->id === $position->id && CopyPosition::count() === 1, 'copy funding idempotence prevents duplicate transfer');
    $pick = $copy->publishPick($strategy, $copyEvent, 'home', $admin);
    $reject(fn () => $events->update($copyEvent, ['odds_draw' => null, 'version' => $copyEvent->version], $admin), 'published copy pick preserves the original market type');
    $check($position->fresh()->value === 90000 && $position->stakes()->sum('stake') === 10000, 'admin pick reserves correct strategy allocation');
    $copy->publishPick($strategy, $copyEvent, 'home', $admin);
    $check(CopyStake::count() === 1, 'republishing pick cannot duplicate copied stakes');
    $reject(fn () => $copy->close($position), 'copy position cannot return reserved stakes before settlement');
    $copy->changeStatus($position, 'paused');
    $pausedEvent = $fixture('copy-paused');
    $copy->publishPick($strategy, $pausedEvent, 'home', $admin);
    $check(CopyStake::count() === 1, 'paused position does not receive new copied stakes');
    $finish($copyEvent, 1, 0);
    $check($position->fresh()->value === 115000 && $position->fresh()->profit === 15000, 'copy win updates strategy value from accepted odds');
    $settlement->settleEvent($copyEvent, 1, 0, $admin);
    $check($position->fresh()->value === 115000, 'repeated game settlement cannot double-credit copy position');
    $beforeReturn = $user->fresh()->wallet_balance;
    $copy->close($position);
    $copy->close($position);
    $check($user->fresh()->wallet_balance === $beforeReturn + 115000 && $position->fresh()->status === 'closed', 'copy close returns available funds once');
    $reject(fn () => $copy->changeStatus($position, 'active'), 'closed copy position cannot resume');
    $position2 = $copy->fund($user, $strategy, 10000, 'copy-fund-002');
    $copyLossEvent = $fixture('copy-loss');
    $copy->publishPick($strategy, $copyLossEvent, 'home', $admin);
    $finish($copyLossEvent, 0, 1);
    $check($position2->fresh()->value === 9000 && $position2->fresh()->profit === -1000, 'copy losses decrease actual value and profit');
    $copyVoidEvent = $fixture('copy-void');
    $copy->publishPick($strategy, $copyVoidEvent, 'home', $admin);
    $events->void($copyVoidEvent, $admin);
    $check($position2->fresh()->value === 9000 && $position2->fresh()->profit === -1000, 'void copied stake refunds reserve with no fictional profit');
    $check($user->fresh()->wallet_balance === WalletTransaction::where('user_id', $user->id)->sum('amount'), 'wallet equals full immutable ledger sum');
    $check(AdminAudit::where('action', 'event.settled')->exists() && AdminAudit::where('action', 'wallet.approved')->exists() && AdminAudit::where('action', 'copy.pick_published')->exists(), 'admin actions retain audit trail');
    $check(StakingRules::payout(1001, ['1.1100', '1.1100']) === 1233, 'decimal payout never uses floating point');
    $check(StakingRules::payout(100000000, array_fill(0, 20, '1.0001')) === 100200190, 'twenty-leg payout preserves full decimal product before rounding');
    try {
        WalletTransaction::first()->update(['amount' => 123]);
        $check(false, 'ledger model refuses monetary history rewrites');
    } catch (LogicException) {
        $check(true, 'ledger model refuses monetary history rewrites');
    }
    $reject(fn () => StakingRules::payout(100000000, ['1000.0000', '1000.0000']), 'excessive potential liability is rejected');
    $check(WalletRequest::where('status', 'pending')->count() === 1, 'unapproved extra deposit remains pending');
    // Exercise real concurrent database connections rather than merely repeating sequential calls.
    if (function_exists('pcntl_fork')) {
        $race = function (callable $action) use ($path, $check): array {
            $directory = $path.'-race-'.bin2hex(random_bytes(4));
            mkdir($directory, 0700);
            DB::disconnect('sqlite');
            $children = [];
            for ($index = 0; $index < 2; $index++) {
                $pid = pcntl_fork();
                if ($pid === -1) {
                    throw new RuntimeException('Unable to start concurrency test process.');
                }
                if ($pid === 0) {
                    DB::purge('sqlite');
                    $deadline = microtime(true) + 10;
                    while (! is_file($directory.'/start') && microtime(true) < $deadline) {
                        usleep(1000);
                    }
                    try {
                        $value = $action($index);
                        $result = ['status' => 'accepted', 'value' => $value];
                    } catch (ValidationException $error) {
                        $result = ['status' => 'rejected', 'errors' => $error->errors()];
                    } catch (Throwable $error) {
                        $result = ['status' => 'error', 'message' => get_class($error).': '.$error->getMessage()];
                    }
                    file_put_contents($directory.'/'.$index.'.json', json_encode($result));
                    DB::disconnect('sqlite');
                    exit(0);
                }
                $children[] = $pid;
            }
            touch($directory.'/start');
            foreach ($children as $pid) {
                pcntl_waitpid($pid, $status);
                $check(pcntl_wexitstatus($status) === 0, 'parallel worker exits successfully');
            }
            DB::purge('sqlite');
            $results = [];
            for ($index = 0; $index < 2; $index++) {
                $results[] = json_decode(file_get_contents($directory.'/'.$index.'.json'), true);
                unlink($directory.'/'.$index.'.json');
            }
            unlink($directory.'/start');
            rmdir($directory);
            foreach ($results as $result) {
                $check($result['status'] !== 'error', 'concurrent connection completes without a database error: '.($result['message'] ?? ''));
            }
            return $results;
        };
        $raceUser = User::create(['name' => 'Race member', 'email' => 'race@test.invalid', 'password' => 'A-safe-test-password']);
        // Synthetic approved identity keeps these financial regression fixtures focused on settlement.
        \App\Models\KycSubmission::create(['user_id' => $raceUser->id, 'status' => 'approved', 'version' => 2, 'consented_at' => now(), 'reviewed_by' => $admin->id, 'reviewed_at' => now()]);
        $wallet->credit($raceUser, 1000, 'deposit', 'race-funding-001');
        $raceEvent = $fixture('concurrent-duplicate');
        $raceSelection = $select($raceEvent);
        $results = $race(fn () => app(BettingService::class)->place($raceUser, [$raceSelection], 1000, 'single', 'concurrent-bet-001')->id);
        $check($results[0]['status'] === 'accepted' && $results[1]['status'] === 'accepted' && $results[0]['value'] === $results[1]['value'], 'simultaneous duplicate bet requests return the same accepted bet');
        $check(Bet::where('user_id', $raceUser->id)->count() === 1 && $raceUser->fresh()->wallet_balance === 0, 'simultaneous duplicate bets create one stake debit');
        $wallet->credit($raceUser, 1000, 'deposit', 'race-funding-002');
        $spendEvent = $fixture('concurrent-spend');
        $spendSelection = $select($spendEvent);
        $results = $race(fn (int $index) => app(BettingService::class)->place($raceUser, [$spendSelection], 1000, 'single', 'concurrent-spend-00'.$index)->id);
        $check(count(array_filter($results, fn ($result) => $result['status'] === 'accepted')) === 1 && count(array_filter($results, fn ($result) => $result['status'] === 'rejected')) === 1, 'concurrent bets competing for the same wallet funds accept only one');
        $check($raceUser->fresh()->wallet_balance === 0 && Bet::where('user_id', $raceUser->id)->count() === 2, 'concurrent wallet cannot overspend or leave a failed bet record');
        Carbon::setTestNow(now()->addHours(4));
        $results = $race(fn () => app(SettlementService::class)->settleEvent($raceEvent, 1, 0, $admin)->id);
        $check($results[0]['status'] === 'accepted' && $results[1]['status'] === 'accepted', 'concurrent identical final score submissions both complete safely');
        $check($raceUser->fresh()->wallet_balance === 2500 && WalletTransaction::where('user_id', $raceUser->id)->where('type', 'payout')->count() === 1, 'concurrent final score submissions issue one payout');
        $raceWithdrawal = $requests->create($raceUser, 'withdrawal', 1000, 'Bank transfer', [], 'race-withdraw-001');
        $race(fn () => app(WalletRequestService::class)->review($raceWithdrawal, false, $admin, 'Rejected in integration test')->id);
        $check($raceUser->fresh()->wallet_balance === 2500, 'concurrent withdrawal rejection refunds reserved funds once');
        $beforeConcurrentReturn = $user->fresh()->wallet_balance;
        $race(fn () => app(CopyService::class)->close($position2)->id);
        $check($user->fresh()->wallet_balance === $beforeConcurrentReturn + 9000, 'concurrent copy closure returns strategy funds once');
    } else {
        echo "SKIP: pcntl is unavailable; concurrent connection tests were not run.\n";
    }
    echo "PASS: {$count} staking database integration checks.\n";
} finally {
    Carbon::setTestNow();
    if (isset($app)) {
        DB::disconnect('sqlite');
    }
    @unlink($path);
}
