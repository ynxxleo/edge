<?php

/** Promotional credit integration checks in a disposable database; no real funds or provider calls. */
require __DIR__.'/../vendor/autoload.php';

use App\Models\AdminAudit;
use App\Models\CopyStrategy;
use App\Models\KycSubmission;
use App\Models\PromoCode;
use App\Models\PromoCodeRedemption;
use App\Models\User;
use App\Models\WalletRequest;
use App\Models\WalletTransaction;
use App\Services\BettingService;
use App\Services\CopyService;
use App\Services\EventService;
use App\Services\PromoCodeService;
use App\Services\SettlementService;
use App\Services\StakingCurrency;
use App\Services\StakingRules;
use App\Services\WalletRequestService;
use App\Services\WalletService;
use Carbon\Carbon;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

$directory = sys_get_temp_dir().'/edge-promo-'.bin2hex(random_bytes(8));
mkdir($directory, 0700);
$database = $directory.'/checks.sqlite';
touch($database);

try {
    $app = require __DIR__.'/../bootstrap/app.php';
    $app->make(Kernel::class)->bootstrap();
    $app['env'] = 'testing';
    config([
        'database.default' => 'sqlite',
        'database.connections.sqlite.database' => $database,
        'database.connections.sqlite.transaction_mode' => 'IMMEDIATE',
        'database.connections.sqlite.busy_timeout' => 5000,
        'cache.default' => 'array',
        // These are synthetic identities in a disposable database, so use fast test-only hashes.
        'hashing.bcrypt.rounds' => 4,
        'kyc.withdrawal_requires_approval' => true,
    ]);
    DB::purge('sqlite');
    Http::preventStrayRequests();
    Artisan::call('migrate', ['--force' => true]);
    CarbonImmutable::setTestNow(CarbonImmutable::parse('2030-03-20 12:00:00', 'UTC'));

    $count = 0;
    $check = function (bool $condition, string $message) use (&$count): void {
        if (! $condition) {
            throw new RuntimeException('FAILED: '.$message);
        }
        $count++;
    };
    $reject = function (callable $action, int $status, string $message, ?string $field = null) use ($check): array {
        try {
            $action();
        } catch (ValidationException $error) {
            $check($status === 422, $message.' (validation status)');
            if ($field !== null) {
                $check(array_key_exists($field, $error->errors()), $message.' (field '.$field.')');
            }
            return $error->errors();
        } catch (HttpExceptionInterface $error) {
            $check($error->getStatusCode() === $status, $message.' (HTTP '.$error->getStatusCode().')');
            return ['message' => [$error->getMessage()]];
        }
        $check(false, $message.' (accepted unexpectedly)');
        return [];
    };
    $immutable = function (callable $action, string $message) use ($check): void {
        try {
            $action();
        } catch (LogicException) {
            $check(true, $message);
            return;
        }
        $check(false, $message);
    };
    $password = 'SyntheticPromoPassword123';
    $user = function (string $name, bool $admin = false) use ($password): User {
        $created = User::create(['name' => $name, 'email' => strtolower(str_replace(' ', '-', $name)).'@promo.test.invalid', 'password' => $password]);
        if ($admin) {
            $created->is_admin = true;
            $created->save();
        }
        return $created;
    };
    $admin = $user('Promo Administrator', true);
    $secondAdmin = $user('Second Promo Administrator', true);
    $member = $user('Promo Member');
    $other = $user('Other Promo Member');
    $promo = app(PromoCodeService::class);
    $wallet = app(WalletService::class);
    $requests = app(WalletRequestService::class);
    $finance = fn (): string => hash('sha256', json_encode([
        DB::table('users')->orderBy('id')->get(['id', 'wallet_balance'])->all(),
        DB::table('wallet_transactions')->orderBy('id')->get()->all(),
        DB::table('wallet_requests')->orderBy('id')->get()->all(),
        DB::table('promo_codes')->orderBy('id')->get()->all(),
        DB::table('promo_code_redemptions')->orderBy('id')->get()->all(),
        DB::table('admin_audits')->orderBy('id')->get()->all(),
    ], JSON_THROW_ON_ERROR));
    $sequence = 0;
    $issueInput = function (array $overrides = []) use (&$sequence, $password): array {
        return array_replace([
            'amount_cents' => 25000,
            'label' => 'Synthetic promotion '.++$sequence,
            'current_password' => $password,
            'idempotency_key' => 'promo-issue-synthetic-'.str_pad((string) $sequence, 4, '0', STR_PAD_LEFT),
        ], $overrides);
    };
    $issue = fn (array $overrides = []): array => $promo->issue($admin, $issueInput($overrides));

    $check(StakingCurrency::code() === 'USD', 'new isolated installation uses USD promotion amounts');
    $before = $finance();
    $valid = $issueInput();
    $reject(fn () => $promo->issue($member, $valid), 403, 'customers cannot issue credit codes');
    $reject(fn () => $promo->issue($admin, [...$valid, 'current_password' => 'IncorrectSyntheticPassword']), 422, 'issuing money requires the current administrator password', 'current_password');
    $missingPassword = $valid;
    unset($missingPassword['current_password']);
    $reject(fn () => $promo->issue($admin, $missingPassword), 422, 'issuance cannot omit the password confirmation', 'current_password');
    foreach ([99, 100000001, -100, 0, 100.5, true] as $amount) {
        $reject(fn () => $promo->issue($admin, [...$valid, 'amount_cents' => $amount]), 422, 'invalid amount '.json_encode($amount).' cannot become promotional credit', 'amount_cents');
    }
    foreach (['tiny', str_repeat('x', 101), 'bad key containing spaces'] as $key) {
        $reject(fn () => $promo->issue($admin, [...$valid, 'idempotency_key' => $key]), 422, 'invalid issuance request key is rejected', 'idempotency_key');
    }
    foreach (['2030-03-19T12:00:00Z', '2030-03-20T12:00:00Z', '2030-03-21 12:00:00', 'not-a-date'] as $expiry) {
        $reject(fn () => $promo->issue($admin, [...$valid, 'expires_at' => $expiry]), 422, 'expiry must be a future timestamp with a time zone', 'expires_at');
    }
    $reject(fn () => $promo->issue($admin, [...$valid, 'label' => str_repeat('x', 101)]), 422, 'promotion labels have a bounded length', 'label');
    $reject(fn () => $promo->issue($admin, [...$valid, 'code' => 'CUSTOMCODE1234567']), 422, 'administrators cannot inject a weak custom code', 'code');
    $check($finance() === $before, 'all rejected issuance attempts leave codes, audit history and balances unchanged');

    $input = $issueInput(['expires_at' => '2030-03-21T12:00:00Z']);
    $issued = $promo->issue($admin, $input);
    $record = $issued['promo_code'];
    $code = $issued['code'];
    $check($record instanceof PromoCode && $issued['idempotent'] === false, 'issuance creates one real promotion record');
    $check((bool) preg_match('/\A(?=.*[A-Z])(?=.*[0-9])[A-Z0-9]{16}\z/D', $code), 'generated codes have exactly sixteen characters with letters and numbers');
    $check($record->amount === 25000 && $record->currency === 'USD', 'the issued amount and currency are snapshotted in integer cents');
    $check($record->created_by === $admin->id && $record->version === 1, 'issuance records the responsible administrator and initial revision');
    $check($member->fresh()->wallet_balance === 0 && WalletTransaction::count() === 0, 'code creation alone never credits any wallet');
    $beforeRetry = $finance();
    $retry = $promo->issue($admin, $input);
    $check($retry['idempotent'] === true && $retry['promo_code']->id === $record->id && $retry['code'] === $code, 'an exact issuance retry returns the original code instead of minting another');
    $check($finance() === $beforeRetry, 'an issuance retry adds neither a code nor an audit entry');
    foreach (['amount_cents' => 25100, 'label' => 'Different promotion', 'expires_at' => '2030-03-22T12:00:00Z'] as $field => $value) {
        $reject(fn () => $promo->issue($admin, [...$input, $field => $value]), 409, 'an issuance key cannot change '.$field);
    }
    $check($finance() === $beforeRetry, 'conflicting issuance retries preserve the complete committed state');
    $anotherAdmin = $promo->issue($secondAdmin, $input);
    $check($anotherAdmin['promo_code']->id !== $record->id && $anotherAdmin['code'] !== $code, 'issuance idempotency keys are scoped to the issuing administrator');

    $raw = (array) DB::table('promo_codes')->where('id', $record->id)->first();
    $check(! str_contains(json_encode($raw, JSON_THROW_ON_ERROR), $code), 'the database never stores a plaintext bearer code');
    $check($raw['code_hash'] === hash('sha256', $code) && $raw['encrypted_code'] !== $code && $record->encrypted_code === $code, 'lookup uses the code hash while the original code is stored as authenticated ciphertext');
    $check(! str_contains(json_encode($record->toArray(), JSON_THROW_ON_ERROR), $code), 'ordinary promotion serialization hides the bearer code');
    $adminData = $promo->adminData($record);
    $check(! str_contains(json_encode($adminData, JSON_THROW_ON_ERROR), $code), 'administrator listings show a masked code rather than its redeemable secret');
    foreach (['code_hash', 'code_ciphertext', 'encrypted_code', 'issuance_key_hash', 'current_password', 'password'] as $privateKey) {
        $check(! array_key_exists($privateKey, $adminData), 'administrator listing excludes internal field '.$privateKey);
    }
    $check(! str_contains(DB::table('admin_audits')->get()->toJson(), $code) && ! str_contains(DB::table('admin_audits')->get()->toJson(), $password), 'general audit records contain neither code nor administrator password');

    $generated = [$code, $anotherAdmin['code']];
    for ($index = 0; $index < 5; $index++) {
        $sample = $issue(['amount_cents' => 100]);
        $generated[] = $sample['code'];
        $check((bool) preg_match('/\A(?=.*[A-Z])(?=.*[0-9])[A-Z0-9]{16}\z/D', $sample['code']), 'additional generated sample '.$index.' has the required alphabet and length');
    }
    $check(count($generated) === count(array_unique($generated)), 'independent promotional codes are unique');
    $maximum = $issue(['amount_cents' => StakingRules::MAX_AMOUNT]);
    $check($maximum['promo_code']->amount === StakingRules::MAX_AMOUNT, 'the documented maximum amount is accepted without rounding or overflow');
    $active = $anotherAdmin['promo_code'];
    $immutable(fn () => $active->fresh()->update(['amount' => 99900]), 'unused promotional amounts cannot be rewritten after issuance');
    $immutable(fn () => $active->fresh()->update(['currency' => 'NGN']), 'unused promotional currency cannot be rewritten after issuance');

    $beforeRedeem = WalletTransaction::count();
    $redeemed = $promo->redeem($member, ['code' => '  '.strtolower($code).'  ']);
    $redemption = $redeemed['redemption'];
    $check($redemption instanceof PromoCodeRedemption && $redeemed['already_redeemed'] === false, 'the first valid redemption records a new successful claim');
    $check($redeemed['wallet_balance_cents'] === 25000 && $member->fresh()->wallet_balance === 25000, 'redemption credits the exact admin amount into the normal cash wallet');
    $check(WalletTransaction::count() === $beforeRedeem + 1 && PromoCodeRedemption::where('promo_code_id', $record->id)->count() === 1, 'one redemption creates one durable ledger entry and one claim');
    $credit = WalletTransaction::where('user_id', $member->id)->where('type', 'promo_credit')->sole();
    $check($credit->amount === 25000 && $credit->balance_after === 25000, 'promotional credit uses its distinct positive ledger type and resulting balance');
    $check(! str_contains(json_encode($credit->toArray(), JSON_THROW_ON_ERROR), $code), 'cash ledger metadata never contains the redeemable code');
    $data = $promo->redemptionData($redemption);
    $check(! str_contains(json_encode($data, JSON_THROW_ON_ERROR), $code), 'redemption responses do not echo or persist the bearer code');
    $beforeRetry = $finance();
    $same = $promo->redeem($member, ['code' => $code]);
    $check($same['already_redeemed'] === true && $same['redemption']->id === $redemption->id, 'the original customer can safely retry a successful redemption');
    $check($finance() === $beforeRetry, 'a redemption retry never duplicates balance, ledger, claim or audit history');
    $usedErrors = $reject(fn () => $promo->redeem($other, ['code' => $code]), 422, 'a code cannot fund a second customer', 'code');
    $unknownErrors = $reject(fn () => $promo->redeem($other, ['code' => 'ZZZZ0000ZZZZ0000']), 422, 'an unknown well-formed code cannot credit funds', 'code');
    $check($usedErrors === $unknownErrors, 'unavailable code responses do not disclose whether another customer used the code');
    foreach (['', 'short123', str_repeat('A', 17), 'ABCD!FGH12345678', ['nested' => 'value']] as $invalid) {
        $reject(fn () => $promo->redeem($other, ['code' => $invalid]), 422, 'malformed code input is rejected', 'code');
    }
    $reject(fn () => $promo->redeem($other, ['code' => $anotherAdmin['code'], 'amount_cents' => 999999]), 422, 'the redeemer cannot override the attached credit amount', 'amount_cents');
    $check($finance() === $beforeRetry, 'all invalid or already-used redemption attempts leave financial state unchanged');

    $revocable = $issue();
    $revokeInput = ['version' => $revocable['promo_code']->version, 'current_password' => $password];
    $beforeRevoke = $finance();
    $reject(fn () => $promo->revoke($revocable['promo_code'], $member, $revokeInput), 403, 'customers cannot revoke an administrator code');
    $reject(fn () => $promo->revoke($revocable['promo_code'], $admin, [...$revokeInput, 'current_password' => 'IncorrectSyntheticPassword']), 422, 'revocation also requires the administrator password', 'current_password');
    $reject(fn () => $promo->revoke($revocable['promo_code'], $admin, [...$revokeInput, 'version' => 999]), 409, 'stale revocation revisions cannot overwrite current state');
    $reject(fn () => $promo->revoke($revocable['promo_code'], $admin, [...$revokeInput, 'unexpected' => true]), 422, 'revocation rejects unrecognized fields', 'unexpected');
    $check($finance() === $beforeRevoke, 'failed revocation attempts change no code, audit or wallet');
    $revoked = $promo->revoke($revocable['promo_code'], $admin, $revokeInput);
    $check($revoked->status === 'revoked' && $revoked->version === 2, 'authorized revocation closes an unused code with a new revision');
    $before = $finance();
    $sameRevocation = $promo->revoke($revocable['promo_code'], $admin, $revokeInput);
    $check($sameRevocation->id === $revoked->id && $finance() === $before, 'an exact revocation retry preserves one final state and one audit entry');
    $before = $finance();
    $revokedErrors = $reject(fn () => $promo->redeem($other, ['code' => $revocable['code']]), 422, 'revoked codes cannot credit funds', 'code');
    $check($revokedErrors === $unknownErrors && $finance() === $before, 'revoked-code rejection reveals no validity details and changes no financial state');
    $reject(fn () => $promo->revoke($record->fresh(), $admin, ['version' => $record->fresh()->version, 'current_password' => $password]), 409, 'already-redeemed cash credit cannot be revoked or debited through the code');
    $check($member->fresh()->wallet_balance === 25000, 'revocation never confiscates a previously redeemed wallet credit');

    $formerAdmin = $user('Former Promo Administrator', true);
    $formerCode = $promo->issue($formerAdmin, $issueInput());
    DB::table('users')->where('id', $formerAdmin->id)->update(['is_admin' => false]);
    $before = $finance();
    $reject(fn () => $promo->issue($formerAdmin, $issueInput()), 403, 'a stale administrator object cannot issue after account demotion');
    $reject(fn () => $promo->revoke($formerCode['promo_code'], $formerAdmin, ['version' => 1, 'current_password' => $password]), 403, 'a stale administrator object cannot revoke after account demotion');
    $check($finance() === $before, 'fresh role checks protect issuance and revocation without changing financial records');
    DB::table('users')->where('id', $formerAdmin->id)->update(['is_admin' => true, 'password' => Hash::make('UpdatedSyntheticPromoPassword123')]);
    $before = $finance();
    $reject(fn () => $promo->issue($formerAdmin, $issueInput()), 422, 'a stale administrator object cannot confirm an obsolete password on issuance', 'current_password');
    $reject(fn () => $promo->revoke($formerCode['promo_code'], $formerAdmin, ['version' => 1, 'current_password' => $password]), 422, 'a stale administrator object cannot confirm an obsolete password on revocation', 'current_password');
    $check($finance() === $before, 'fresh password checks leave promotional state unchanged on old credentials');

    $expiring = $issue(['expires_at' => now()->addSeconds(1)->toIso8601String()]);
    CarbonImmutable::setTestNow(CarbonImmutable::now()->addSeconds(1));
    $before = $finance();
    $expiredErrors = $reject(fn () => $promo->redeem($other, ['code' => $expiring['code']]), 422, 'codes expire at the exact configured instant', 'code');
    $check($expiredErrors === $unknownErrors && $finance() === $before, 'expired-code failure is generic and atomic');
    $check($promo->adminData($expiring['promo_code']->fresh())['status'] === 'expired', 'administrator listings distinguish expired codes from currently redeemable codes');

    // Currency changes here affect only this disposable database, never the configured application.
    DB::table('payment_settings')->where('id', 1)->update(['wallet_currency' => 'NGN']);
    $ngn = $issue();
    $check($ngn['promo_code']->currency === 'NGN', 'issuance snapshots the stored wallet currency rather than an assumed display currency');
    $before = $finance();
    $sameCurrencyRetry = $promo->redeem($member, ['code' => $code]);
    $check($sameCurrencyRetry['already_redeemed'] && $finance() === $before, 'a successful owner retry remains safe after the configured currency changes');
    DB::table('payment_settings')->where('id', 1)->update(['wallet_currency' => 'USD']);
    $before = $finance();
    $currencyErrors = $reject(fn () => $promo->redeem($other, ['code' => $ngn['code']]), 422, 'a code cannot be silently relabeled into a different wallet currency', 'code');
    $check($currencyErrors === $unknownErrors && $finance() === $before, 'currency mismatch neither leaks code validity nor consumes the code');

    $capacityMember = $user('Capacity Promo Member');
    $wallet->credit($capacityMember, StakingRules::MAX_PAYOUT * 100, 'deposit', 'synthetic-promo-capacity');
    $capacity = $issue(['amount_cents' => 100]);
    $before = $finance();
    $reject(fn () => $promo->redeem($capacityMember, ['code' => $capacity['code']]), 422, 'credit cannot exceed the normal cash wallet capacity');
    $check($finance() === $before && ! PromoCodeRedemption::where('promo_code_id', $capacity['promo_code']->id)->exists(), 'wallet-capacity failure rolls back code consumption, ledger and audit together');
    $recovered = $promo->redeem($other, ['code' => $capacity['code']]);
    $check($recovered['already_redeemed'] === false && $other->fresh()->wallet_balance === 100, 'a code remains usable by an eligible customer after a failed wallet credit');

    // Promotional cash follows the existing withdrawal policy and regular reservation/refund ledger.
    $before = $finance();
    $reject(fn () => $requests->create($member, 'withdrawal', 10000, 'bank_transfer', [], 'promo-withdraw-unverified'), 422, 'promotional cash still requires approved KYC before withdrawal', 'kyc');
    $check($finance() === $before, 'unverified withdrawal creates no request and reserves no promotional cash');
    KycSubmission::create(['user_id' => $member->id, 'status' => 'approved', 'version' => 2, 'requirements_version' => 0, 'consented_at' => now(), 'reviewed_by' => $admin->id, 'reviewed_at' => now()]);
    $withdrawal = $requests->create($member, 'withdrawal', 10000, 'bank_transfer', ['account' => 'SYNTHETIC-PROMO-BANK'], 'promo-withdraw-reserve');
    $check($withdrawal->status === 'pending' && $member->fresh()->wallet_balance === 15000, 'a verified customer can reserve promotional credit for withdrawal');
    $requests->review($withdrawal, false, $admin, 'Synthetic rejected withdrawal');
    $requests->review($withdrawal, false, $admin, 'Synthetic rejected withdrawal');
    $check($member->fresh()->wallet_balance === 25000, 'a rejected promotional withdrawal refunds the reservation exactly once');
    $withdrawal = $requests->create($member, 'withdrawal', 10000, 'bank_transfer', [], 'promo-withdraw-approved');
    $requests->review($withdrawal, true, $admin, 'SYNTHETIC-PROMO-PAYOUT-0001');
    $requests->review($withdrawal, true, $admin, 'SYNTHETIC-PROMO-PAYOUT-0001');
    $check($withdrawal->fresh()->status === 'approved' && $member->fresh()->wallet_balance === 15000, 'approved promotional withdrawals complete through the existing payment review without a second debit');
    $before = $finance();
    $same = $promo->redeem($member, ['code' => $code]);
    $check($same['already_redeemed'] === true && $same['wallet_balance_cents'] === 15000 && $finance() === $before, 'retrying a spent code returns the current wallet balance without restoring spent promotional cash');

    $events = app(EventService::class);
    $settlement = app(SettlementService::class);
    $event = fn (string $suffix) => $events->create([
        'sport' => 'football', 'league' => 'Synthetic promotion checks', 'country' => 'Test',
        'home_name' => 'Promo Home '.$suffix, 'away_name' => 'Promo Away '.$suffix,
        'starts_at' => now()->addHours(2), 'status' => 'open', 'odds_home' => '2.5000', 'odds_away' => '2.8000', 'odds_draw' => null,
    ], $admin);
    $stakeMember = $user('Staking Promo Member');
    $stakeCode = $issue(['amount_cents' => 50000]);
    $promo->redeem($stakeMember, ['code' => $stakeCode['code']]);
    $game = $event('direct');
    $bet = app(BettingService::class)->place($stakeMember, [['event_id' => $game->id, 'outcome' => 'home', 'expected_odds' => $game->odds_home, 'expected_version' => $game->version]], 10000, 'single', 'promo-direct-stake');
    $check($bet->stake === 10000 && $stakeMember->fresh()->wallet_balance === 40000, 'promotional cash is immediately available for an ordinary sports stake');
    CarbonImmutable::setTestNow(CarbonImmutable::now()->addHours(4));
    $settlement->settleEvent($game, 1, 0, $admin);
    $check($bet->fresh()->status === 'won' && $stakeMember->fresh()->wallet_balance === 65000, 'a sports win funded by promotional cash pays through the ordinary settlement ledger');

    $copyMember = $user('Copy Promo Member');
    $copyCode = $issue(['amount_cents' => 50000]);
    $promo->redeem($copyMember, ['code' => $copyCode['code']]);
    $strategy = CopyStrategy::create(['name' => 'Synthetic promotional copy', 'slug' => 'synthetic-promo-copy', 'sport' => 'football', 'description' => 'Synthetic integration fixture', 'risk' => 'balanced', 'stake_percentage' => 10, 'active' => true]);
    $copy = app(CopyService::class);
    $position = $copy->fund($copyMember, $strategy, 25000, 'promo-copy-funding');
    $check($position->value === 25000 && $copyMember->fresh()->wallet_balance === 25000, 'promotional cash can fund copy staking through the same wallet');
    $game = $event('copy');
    $copy->publishPick($strategy, $game, 'home', $admin);
    CarbonImmutable::setTestNow(CarbonImmutable::now()->addHours(4));
    $settlement->settleEvent($game, 1, 0, $admin);
    $copy->close($position);
    $check($position->fresh()->status === 'closed' && $copyMember->fresh()->wallet_balance === 53750, 'copy staking profit and original promotional allocation return as normal cash');

    // Real independent connections contend for a single code and for revocation versus redemption.
    if (function_exists('pcntl_fork')) {
        $race = function (string $name, callable $action) use ($directory, $check): array {
            $raceDirectory = $directory.'/'.$name;
            mkdir($raceDirectory, 0700);
            DB::disconnect('sqlite');
            $children = [];
            for ($index = 0; $index < 2; $index++) {
                $pid = pcntl_fork();
                if ($pid === -1) {
                    throw new RuntimeException('Unable to start promotional concurrency worker.');
                }
                if ($pid === 0) {
                    DB::purge('sqlite');
                    $deadline = microtime(true) + 10;
                    while (! is_file($raceDirectory.'/start') && microtime(true) < $deadline) {
                        usleep(1000);
                    }
                    try {
                        $value = $action($index);
                        $result = ['status' => 'accepted', 'value' => $value];
                    } catch (ValidationException $error) {
                        $result = ['status' => 'rejected', 'errors' => $error->errors()];
                    } catch (HttpExceptionInterface $error) {
                        $result = ['status' => 'rejected', 'http_status' => $error->getStatusCode()];
                    } catch (Throwable $error) {
                        $result = ['status' => 'error', 'message' => get_class($error).': '.$error->getMessage()];
                    }
                    file_put_contents($raceDirectory.'/'.$index.'.json', json_encode($result, JSON_THROW_ON_ERROR));
                    DB::disconnect('sqlite');
                    exit(0);
                }
                $children[] = $pid;
            }
            touch($raceDirectory.'/start');
            foreach ($children as $pid) {
                pcntl_waitpid($pid, $status);
                $check(pcntl_wifexited($status) && pcntl_wexitstatus($status) === 0, 'concurrent '.$name.' worker exits normally');
            }
            DB::purge('sqlite');
            $results = array_map(fn ($index) => json_decode(file_get_contents($raceDirectory.'/'.$index.'.json'), true, flags: JSON_THROW_ON_ERROR), [0, 1]);
            foreach ($results as $result) {
                $check($result['status'] !== 'error', 'concurrent '.$name.' avoids database failures: '.($result['message'] ?? ''));
            }
            return $results;
        };
        $raceOne = $user('First Racing Promo Member');
        $raceTwo = $user('Second Racing Promo Member');
        $raceCode = $issue(['amount_cents' => 77700]);
        $beforeLedger = WalletTransaction::where('type', 'promo_credit')->count();
        $results = $race('single-use', fn ($index) => app(PromoCodeService::class)->redeem($index === 0 ? $raceOne : $raceTwo, ['code' => $raceCode['code']])['redemption']->id);
        $check(count(array_filter($results, fn ($result) => $result['status'] === 'accepted')) === 1 && count(array_filter($results, fn ($result) => $result['status'] === 'rejected')) === 1, 'only one of two customers can win a simultaneous claim');
        $check($raceOne->fresh()->wallet_balance + $raceTwo->fresh()->wallet_balance === 77700, 'competing customers receive exactly one promotional amount in total');
        $check(PromoCodeRedemption::where('promo_code_id', $raceCode['promo_code']->id)->count() === 1 && WalletTransaction::where('type', 'promo_credit')->count() === $beforeLedger + 1, 'simultaneous claims persist one redemption and one credit');

        $sameMember = $user('Same Owner Racing Promo Member');
        $sameCode = $issue(['amount_cents' => 12300]);
        $results = $race('owner-retry', fn () => app(PromoCodeService::class)->redeem($sameMember, ['code' => $sameCode['code']])['redemption']->id);
        $check($results[0]['status'] === 'accepted' && $results[1]['status'] === 'accepted' && $results[0]['value'] === $results[1]['value'], 'simultaneous same-customer retries return the same accepted claim');
        $check($sameMember->fresh()->wallet_balance === 12300 && PromoCodeRedemption::where('promo_code_id', $sameCode['promo_code']->id)->count() === 1, 'simultaneous same-customer retries credit only once');

        $raceMember = $user('Revocation Racing Promo Member');
        $raceCode = $issue(['amount_cents' => 45600]);
        $results = $race('revoke-redeem', function ($index) use ($promo, $raceMember, $raceCode, $admin, $password) {
            return $index === 0
                ? $promo->redeem($raceMember, ['code' => $raceCode['code']])['redemption']->id
                : $promo->revoke($raceCode['promo_code'], $admin, ['version' => 1, 'current_password' => $password])->id;
        });
        $check(count(array_filter($results, fn ($result) => $result['status'] === 'accepted')) === 1, 'a concurrent revocation and redemption commit exactly one final outcome');
        $final = $raceCode['promo_code']->fresh();
        $claims = PromoCodeRedemption::where('promo_code_id', $final->id)->count();
        $check(($final->status === 'revoked' && $claims === 0 && $raceMember->fresh()->wallet_balance === 0) || ($claims === 1 && $raceMember->fresh()->wallet_balance === 45600 && $final->status !== 'revoked'), 'the race cannot produce a revoked code with a cash credit or an active code with two outcomes');

        $issuanceInput = $issueInput(['amount_cents' => 89000]);
        $beforeCodes = PromoCode::count();
        $results = $race('issue-retry', fn () => app(PromoCodeService::class)->issue($admin, $issuanceInput)['promo_code']->id);
        $check($results[0]['status'] === 'accepted' && $results[1]['status'] === 'accepted' && $results[0]['value'] === $results[1]['value'] && PromoCode::count() === $beforeCodes + 1, 'concurrent issuance retries produce one bearer code rather than duplicate promotional liability');
    } else {
        echo "SKIP: pcntl is unavailable; promotional concurrency checks were not run.\n";
    }

    CarbonImmutable::setTestNow(CarbonImmutable::now()->addDays(2));
    $before = $finance();
    $expiredIssueRetry = $promo->issue($admin, $input);
    $check($expiredIssueRetry['idempotent'] && $expiredIssueRetry['promo_code']->id === $record->id && $expiredIssueRetry['code'] === $code, 'an exact issuance retry after expiration returns the original code without creating new liability');
    $expiredOwnerRetry = $promo->redeem($member, ['code' => $code]);
    $check($expiredOwnerRetry['already_redeemed'] && $expiredOwnerRetry['wallet_balance_cents'] === 15000 && $finance() === $before, 'a previously completed owner claim stays idempotent after its code expires');

    $immutable(fn () => $record->fresh()->update(['amount' => 50000]), 'issued promotional amounts cannot be rewritten');
    $immutable(fn () => $record->fresh()->delete(), 'issued promotional history cannot be deleted');
    $immutable(fn () => $redemption->fresh()->update(['user_id' => $other->id]), 'completed claims cannot be transferred to another customer');
    $immutable(fn () => $redemption->fresh()->delete(), 'redemption history cannot be deleted');
    $immutable(fn () => $credit->fresh()->update(['amount' => 1]), 'the promotional wallet ledger remains immutable');
    $promoAudit = AdminAudit::where('subject_type', 'PromoCode')->firstOrFail();
    $immutable(fn () => $promoAudit->update(['reason' => 'Rewritten promotional history']), 'promotional administrator audit records remain immutable');
    foreach (User::all() as $account) {
        $check($account->wallet_balance === (int) WalletTransaction::where('user_id', $account->id)->sum('amount'), 'cash wallet matches its full ledger for customer '.$account->id);
    }
    $auditJson = DB::table('admin_audits')->get()->toJson();
    foreach ($generated as $secret) {
        $check(! str_contains($auditJson, $secret), 'audit history contains no generated bearer code '.$count);
    }
    $check(! str_contains($auditJson, $password) && ! str_contains($auditJson, 'current_password'), 'all audits exclude password confirmations');
    $check(count(Http::recorded()) === 0, 'the complete promotion workflow calls no payment provider or external service');

    echo "Passed {$count} promotional credit integration checks.\n";
} catch (Throwable $error) {
    fwrite(STDERR, get_class($error).': '.$error->getMessage()."\n");
    $failure = true;
} finally {
    CarbonImmutable::setTestNow();
    Carbon::setTestNow();
    if (isset($app)) {
        DB::disconnect('sqlite');
    }
    $remove = function (string $path) use (&$remove): void {
        if (is_dir($path) && ! is_link($path)) {
            foreach (array_diff(scandir($path), ['.', '..']) as $name) {
                $remove($path.'/'.$name);
            }
            rmdir($path);
        } elseif (file_exists($path)) {
            unlink($path);
        }
    };
    $remove($directory);
}
if ($failure ?? false) {
    exit(1);
}
