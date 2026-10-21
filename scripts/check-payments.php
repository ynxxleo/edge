<?php

/** Payment integration checks: isolated SQLite, dummy keys, no external requests. */
require __DIR__.'/../vendor/autoload.php';

use App\Models\AdminAudit;
use App\Models\PaymentSetting;
use App\Models\StripePayment;
use App\Models\User;
use App\Models\WalletRequest;
use App\Models\WalletTransaction;
use App\Services\PaymentSettingsService;
use App\Services\StripePaymentService;
use App\Services\WalletRequestService;
use App\Services\WalletService;
use Carbon\Carbon;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;

$path = tempnam(sys_get_temp_dir(), 'edge-payments-');
try {
    $app = require __DIR__.'/../bootstrap/app.php';
    $app->make(Kernel::class)->bootstrap();
    $app['env'] = 'testing';
    config(['database.default' => 'sqlite', 'database.connections.sqlite.database' => $path, 'cache.default' => 'array', 'app.url' => 'http://127.0.0.1:8135']);
    DB::purge('sqlite');
    Artisan::call('migrate', ['--force' => true]);
    Carbon::setTestNow(Carbon::parse('2030-03-20 12:00:00', 'UTC'));
    Http::preventStrayRequests();
    $count = 0;
    $check = function (bool $condition, string $message) use (&$count): void {
        if (! $condition) {
            throw new RuntimeException('FAILED: '.$message);
        }
        $count++;
    };
    $reject = function (callable $action, string $message, ?int $status = null) use ($check): void {
        try {
            $action();
        } catch (ValidationException|HttpException $error) {
            $check($status === null || ($error instanceof HttpException && $error->getStatusCode() === $status), $message);
            return;
        }
        $check(false, $message);
    };
    $password = 'Payment-test-password-2026';
    $admin = User::create(['name' => 'Payments admin', 'email' => 'pay-admin@test.invalid', 'password' => $password]);
    $admin->is_admin = true;
    $admin->save();
    $user = User::create(['name' => 'Payments user', 'email' => 'pay-user@test.invalid', 'password' => $password]);
    // Synthetic approved identity keeps these financial regression fixtures focused on settlement.
    \App\Models\KycSubmission::create(['user_id' => $user->id, 'status' => 'approved', 'version' => 2, 'consented_at' => now(), 'reviewed_by' => $admin->id, 'reviewed_at' => now()]);
    $settings = app(PaymentSettingsService::class);
    $stripe = app(StripePaymentService::class);
    $wallet = app(WalletService::class);
    $manual = app(WalletRequestService::class);
    $update = function (array $changes, ?User $actor = null) use ($admin, $settings, $password): PaymentSetting {
        return $settings->update($actor ?? $admin, array_merge(['version' => $settings->current()->version, 'current_password' => $password], $changes));
    };
    $check($settings->publicMethods()['stripe']['enabled'] === false, 'Stripe is disabled by default');
    $check($settings->publicMethods()['manual']['enabled'] === true, 'manual deposits remain available by default');
    $check($settings->publicMethods()['currency'] === 'USD', 'wallet currency is server-owned');
    $reject(fn () => $stripe->checkout($user, 10000, 'disabled-card-001'), 'disabled card checkout rejected');
    $check(StripePayment::count() === 0, 'disabled method creates no provider request');
    $reject(fn () => $update(['stripe_enabled' => true], $user), 'members cannot update credentials', 403);
    $reject(fn () => $settings->update($admin, ['version' => 1, 'current_password' => 'wrong-password', 'stripe_enabled' => false]), 'settings require current administrator password');
    $reject(fn () => $update(['stripe_enabled' => true]), 'enabled Stripe needs all credentials');
    $reject(fn () => $update(['stripe_publishable_key' => 'pk_live_12345678']), 'publishable key must match selected mode');
    $reject(fn () => $update(['stripe_secret_key' => 'sk_live_12345678']), 'secret key must match selected mode');
    $reject(fn () => $update(['stripe_webhook_secret' => 'invalid-signing-key']), 'webhook secret format checked');
    $initial = $update([
        'stripe_enabled' => true, 'stripe_mode' => 'test', 'stripe_publishable_key' => 'pk_test_1234567890',
        'stripe_secret_key' => 'sk_test_1234567890', 'stripe_webhook_secret' => 'whsec_original1234567890',
        'manual_bank_name' => 'Test bank', 'manual_account_name' => 'EDGE test account',
        'manual_account_number' => '0123456789', 'manual_instructions' => 'Transfer only to the listed account.',
        'manual_reference_label' => 'Bank transaction ID', 'manual_support_contact' => 'payments@test.invalid',
    ]);
    $check($initial->version === 2, 'settings version increments atomically');
    $check($settings->publicMethods()['stripe']['enabled'] === true, 'complete configuration enables checkout');
    $rawSettings = DB::table('payment_settings')->first();
    foreach (['stripe_secret_key', 'stripe_webhook_secret', 'manual_bank_name', 'manual_account_name', 'manual_account_number'] as $field) {
        $check($rawSettings->$field !== $initial->$field, $field.' is encrypted at rest');
    }
    $adminJson = json_encode($settings->adminData());
    $publicJson = json_encode($settings->publicMethods());
    foreach (['sk_test_1234567890', 'whsec_original1234567890', 'previous_webhook_secrets'] as $secret) {
        $check(! str_contains($adminJson, $secret) && ! str_contains($publicJson, $secret), 'settings API redacts '.$secret);
    }
    $check($settings->adminData()['settings']['stripe_secret_key_last4'] === '7890', 'admin can identify saved secret suffix');
    $check($settings->adminData()['settings']['stripe_secret_key_configured'] === true, 'admin sees configured status');
    $check(! str_contains(json_encode($initial), 'sk_test_'), 'Eloquent serialization hides secrets');
    $audit = AdminAudit::where('action', 'payment_settings.updated')->first();
    $check(! str_contains(json_encode($audit), 'sk_test_') && ! str_contains(json_encode($audit), '0123456789'), 'audit stores field names, never credentials');
    $check(in_array('stripe_secret_key', $audit->after['changed_fields'], true), 'credential changes remain auditable');
    $reject(fn () => $settings->update($admin, ['version' => 1, 'current_password' => $password]), 'stale settings version rejected', 409);
    $update(['stripe_secret_key' => '', 'stripe_webhook_secret' => null]);
    $check($settings->current()->stripe_secret_key === 'sk_test_1234567890', 'blank API secret preserves saved key');
    $check($settings->current()->stripe_webhook_secret === 'whsec_original1234567890', 'blank signing secret preserves saved key');

    $providerCalls = [];
    $providerBehavior = 'success';
    $providerSession = function ($request): array {
        $data = $request->data();
        $reference = $data['client_reference_id'];
        return [
            'object' => 'checkout.session', 'id' => 'cs_test_'.substr(hash('sha256', $reference), 0, 24),
            'url' => 'https://checkout.stripe.com/c/pay/'.substr(hash('sha256', $reference), 0, 24),
            'mode' => 'payment', 'livemode' => false,
            'amount_total' => $data['line_items'][0]['price_data']['unit_amount'], 'currency' => 'usd',
            'client_reference_id' => $reference, 'metadata' => $data['metadata'],
            'status' => 'open', 'payment_status' => 'unpaid',
        ];
    };
    Http::fake(function ($request) use (&$providerCalls, &$providerBehavior, $providerSession) {
        $providerCalls[] = ['url' => $request->url(), 'data' => $request->data(), 'authorization' => $request->header('Authorization'), 'key' => $request->header('Idempotency-Key')];
        if ($providerBehavior === 'timeout') {
            throw new ConnectionException('Sensitive provider diagnostic must not escape sk_test_1234567890');
        }
        if ($providerBehavior === 'error') {
            return Http::response(['error' => ['message' => 'sk_test_1234567890 is invalid']], 401);
        }
        if ($providerBehavior === 'unavailable') {
            return Http::response(['error' => ['message' => 'Provider unavailable']], 500);
        }
        $session = $providerSession($request);
        if ($providerBehavior === 'unsafe_url') {
            $session['url'] = 'https://evil.test/c/pay/session';
        } elseif ($providerBehavior === 'wrong_currency') {
            $session['currency'] = 'ngn';
        }
        return Http::response($session);
    });
    $first = $stripe->checkout($user, 125000, 'stripe-idempotent-001');
    $check($first->status === 'pending', 'opening checkout does not mark payment paid');
    $check($user->fresh()->wallet_balance === 0, 'checkout response does not credit wallet');
    $check(count($providerCalls) === 1, 'one provider request starts checkout');
    $check($providerCalls[0]['url'] === 'https://api.stripe.com/v1/checkout/sessions', 'Stripe API origin is fixed');
    $check($providerCalls[0]['authorization'] === ['Bearer sk_test_1234567890'], 'secret is sent only to provider');
    $check($providerCalls[0]['key'] === [$first->reference], 'provider gets stable server-generated idempotency key');
    $check($providerCalls[0]['data']['payment_method_types'] === ['card'], 'checkout offers card payments only');
    $check($providerCalls[0]['data']['line_items'][0]['price_data']['currency'] === 'usd', 'Checkout amount is USD minor units');
    $check($first->currency === 'USD' && $first->publicData()['currency'] === 'USD', 'stored and public card deposits retain the USD denomination');
    $check(str_contains($providerCalls[0]['data']['success_url'], 'payment_ref='.$first->reference), 'return URL carries server reference');
    $check(str_starts_with($providerCalls[0]['data']['success_url'], 'http://127.0.0.1:8135/'), 'return URL comes from app configuration');
    $check(str_starts_with($providerCalls[0]['data']['success_url'], 'http://127.0.0.1:8135/app?'), 'successful checkout returns directly to the platform');
    $check(str_starts_with($providerCalls[0]['data']['cancel_url'], 'http://127.0.0.1:8135/app?') && str_ends_with($providerCalls[0]['data']['cancel_url'], '#wallet'), 'canceled checkout returns to the platform wallet');
    $check($first->pending_secret_key === null && $first->pending_payload === null, 'checkout credentials cleared after provider response');
    $check(! str_contains(json_encode($first->publicData()), 'sk_test_'), 'payment status data contains no secret');
    $check($stripe->checkout($user, 125000, 'stripe-idempotent-001')->id === $first->id, 'identical retry returns original payment');
    $check(count($providerCalls) === 1, 'completed checkout creation retries do not call provider again');
    $reject(fn () => $stripe->checkout($user, 125001, 'stripe-idempotent-001'), 'idempotency key cannot change amount');
    foreach ([0, 9999, 100000000] as $badAmount) {
        $reject(fn () => $stripe->checkout($user, $badAmount, 'invalid-amount-'.$badAmount), 'invalid checkout amount '.$badAmount.' rejected');
    }

    $event = function (StripePayment $payment, string $id, array $sessionChanges = [], string $type = 'checkout.session.completed', array $eventChanges = []): array {
        return array_replace([
            'id' => $id, 'type' => $type, 'livemode' => false,
            'data' => ['object' => array_replace([
                'object' => 'checkout.session', 'id' => $payment->session_id, 'client_reference_id' => $payment->reference,
                'metadata' => ['payment_reference' => $payment->reference, 'user_id' => (string) $payment->user_id],
                'amount_total' => $payment->amount, 'currency' => 'usd', 'mode' => 'payment', 'livemode' => false,
                'status' => 'complete', 'payment_status' => 'paid', 'payment_intent' => 'pi_'.substr(hash('sha256', $payment->reference), 0, 24),
            ], $sessionChanges)],
        ], $eventChanges);
    };
    $deliver = function (array $eventData, ?string $secret = null, ?int $timestamp = null, ?string $header = null) use ($stripe, $settings): array {
        $body = json_encode($eventData, JSON_UNESCAPED_SLASHES);
        $timestamp ??= now()->timestamp;
        $secret ??= $settings->current()->stripe_webhook_secret;
        return $stripe->webhook($body, $header ?? 't='.$timestamp.',v1='.hash_hmac('sha256', $timestamp.'.'.$body, $secret));
    };
    $paid = $event($first, 'evt_FirstPaid');
    $reject(fn () => $deliver($paid, header: ''), 'unsigned webhook rejected', 400);
    $reject(fn () => $deliver($paid, secret: 'whsec_wrong12345678'), 'wrong signing key rejected', 400);
    $reject(fn () => $deliver($paid, timestamp: now()->subSeconds(301)->timestamp), 'stale signature rejected', 400);
    $reject(fn () => $deliver($paid, timestamp: now()->addSeconds(301)->timestamp), 'future signature rejected', 400);
    $check($user->fresh()->wallet_balance === 0, 'invalid signatures never credit money');
    foreach ([
        'wrongAmount' => ['amount_total' => $first->amount + 1], 'wrongCurrency' => ['currency' => 'ngn'],
        'wrongSessionMode' => ['livemode' => true], 'wrongSession' => ['id' => 'cs_test_otherSession'],
        'wrongClient' => ['client_reference_id' => 'another-reference'], 'wrongType' => ['mode' => 'subscription'],
        'wrongUser' => ['metadata' => ['payment_reference' => $first->reference, 'user_id' => (string) $admin->id]],
        'wrongReference' => ['metadata' => ['payment_reference' => 'unknown-reference', 'user_id' => (string) $user->id]],
        'missingIntent' => ['payment_intent' => null], 'incomplete' => ['status' => 'open'],
    ] as $label => $changes) {
        $reject(fn () => $deliver($event($first, 'evt_'.$label, $changes)), $label.' binding rejected', 400);
    }
    $reject(fn () => $deliver($event($first, 'evt_WrongEventMode', eventChanges: ['livemode' => true])), 'event mode must match stored mode', 400);
    $check(DB::table('stripe_webhook_events')->count() === 0, 'invalid events are not acknowledged as processed');
    $check($user->fresh()->wallet_balance === 0, 'mismatched signed event never credits wallet');
    $legacyKey = 'legacy-naira-payment-001';
    $legacyReference = \App\Services\StakingRules::reference('stripe', $user, $legacyKey);
    $legacy = StripePayment::create([
        'user_id' => $user->id, 'reference' => $legacyReference,
        'request_hash' => hash('sha256', json_encode([$user->id, 12000, 'NGN'])),
        'amount' => 12000, 'currency' => 'NGN', 'mode' => 'test', 'status' => 'pending',
        'session_id' => 'cs_test_LegacyNairaSession',
    ]);
    $reject(fn () => $deliver($event($legacy, 'evt_LegacyNairaPaid', ['currency' => 'ngn'])), 'legacy NGN confirmation cannot credit a USD wallet', 400);
    $reject(fn () => $deliver($event($legacy, 'evt_LegacyForgedUsd')), 'USD payload cannot re-denominate a saved NGN payment', 400);
    $check($legacy->fresh()->status === 'pending' && $user->fresh()->wallet_balance === 0, 'rejected legacy deposits preserve payment and wallet state');
    $providerCount = count($providerCalls);
    $reject(fn () => $stripe->checkout($user, 12000, $legacyKey), 'legacy NGN checkout cannot be reused for a USD deposit');
    $check(count($providerCalls) === $providerCount, 'legacy currency retry never contacts the card provider');
    $unpaid = $event($first, 'evt_Unpaid', ['payment_status' => 'unpaid', 'payment_intent' => null]);
    $check($deliver($unpaid)['received'], 'unpaid completion acknowledged');
    $check($first->fresh()->status === 'processing', 'unpaid completion remains processing');
    $check($user->fresh()->wallet_balance === 0, 'unpaid completion never credits wallet');
    $check($deliver($paid)['received'], 'valid paid webhook accepted');
    $check($first->fresh()->status === 'paid', 'signed payment confirmation marks paid');
    $check($user->fresh()->wallet_balance === 125000, 'paid webhook credits exact amount');
    $check(WalletTransaction::count() === 1, 'paid webhook creates one ledger entry');
    $check(WalletTransaction::first()->metadata['mode'] === 'test', 'sandbox funds are clearly tagged');
    $check($deliver($paid)['duplicate'] === true, 'same event ID replay recognized');
    $check($deliver($event($first, 'evt_AnotherPaid'))['received'], 'distinct paid event for same session accepted');
    $check($user->fresh()->wallet_balance === 125000 && WalletTransaction::count() === 1, 'event replay and distinct event IDs cannot double-credit');
    $reject(fn () => $deliver($event($first, 'evt_FirstPaid', ['amount_total' => 99999])), 'event ID cannot be reused with different data', 409);
    $deliver($event($first, 'evt_LateExpiry', ['payment_status' => 'unpaid', 'status' => 'expired'], 'checkout.session.expired'));
    $deliver($event($first, 'evt_LateFailure', ['payment_status' => 'unpaid'], 'checkout.session.async_payment_failed'));
    $check($first->fresh()->status === 'paid', 'out-of-order expiry and failure cannot revoke paid funds');
    $check($stripe->checkout($user, 125000, 'stripe-idempotent-001')->status === 'paid', 'paid request remains paid on retry');
    $check(WalletRequest::count() === 0, 'Stripe payments are never manual review requests');

    $second = $stripe->checkout($user, 20000, 'stripe-payment-002');
    $deliver($event($second, 'evt_SecondExpired', ['payment_status' => 'unpaid', 'status' => 'expired'], 'checkout.session.expired'));
    $check($second->fresh()->status === 'expired', 'expiry closes unpaid checkout');
    $reject(fn () => $stripe->checkout($user, 20000, 'stripe-payment-002'), 'expired checkout cannot be reopened');
    $deliver($event($second, 'evt_LateUnpaid', ['payment_status' => 'unpaid']));
    $check($second->fresh()->status === 'expired', 'unpaid completion cannot reopen expired checkout');
    $deliver($event($second, 'evt_DelayedPaid', type: 'checkout.session.async_payment_succeeded'));
    $check($second->fresh()->status === 'paid', 'late genuine payment confirmation settles exactly once');
    $check($user->fresh()->wallet_balance === 145000, 'late signed payment credits exact funds');

    $third = $stripe->checkout($user, 30000, 'stripe-payment-003');
    $update(['stripe_webhook_secret' => 'whsec_rotated1234567890']);
    $rawPrevious = DB::table('payment_settings')->value('previous_webhook_secrets');
    $check(! str_contains($rawPrevious, 'whsec_original'), 'rollover signing secrets are encrypted at rest');
    $check($deliver($event($third, 'evt_OldSigningKey'), 'whsec_original1234567890')['received'], 'in-flight webhook accepts previous signing key during rollover');
    $fourth = $stripe->checkout($user, 40000, 'stripe-payment-004');
    $newEvent = $event($fourth, 'evt_MultipleSignatures');
    $body = json_encode($newEvent, JSON_UNESCAPED_SLASHES);
    $header = 't='.now()->timestamp.',v1='.str_repeat('0', 64).',v1='.hash_hmac('sha256', now()->timestamp.'.'.$body, 'whsec_rotated1234567890');
    $check($stripe->webhook($body, $header)['received'], 'multiple v1 signatures supported');
    Carbon::setTestNow(now()->addHours(25));
    $reject(fn () => $deliver($event($third, 'evt_ExpiredSigningKey'), 'whsec_original1234567890'), 'previous signing key expires after rollover', 400);

    $providerBehavior = 'timeout';
    try {
        $stripe->checkout($user, 50000, 'stripe-timeout-005');
        $check(false, 'provider timeout rejects checkout');
    } catch (HttpException $error) {
        $check($error->getStatusCode() === 503 && ! str_contains($error->getMessage(), 'sk_test_'), 'provider timeout is redacted');
    }
    $ambiguous = StripePayment::where('amount', 50000)->firstOrFail();
    $check($ambiguous->status === 'pending' && filled($ambiguous->pending_secret_key), 'ambiguous request remains retryable');
    $check(! str_contains(DB::table('stripe_payments')->where('id', $ambiguous->id)->value('pending_secret_key'), 'sk_test_'), 'pending API key snapshot is encrypted');
    $update(['stripe_secret_key' => 'sk_test_rotated12345678']);
    $providerBehavior = 'success';
    $retried = $stripe->checkout($user, 50000, 'stripe-timeout-005');
    $check($retried->id === $ambiguous->id, 'ambiguous timeout retries same payment');
    $last = end($providerCalls);
    $check($last['authorization'] === ['Bearer sk_test_1234567890'], 'ambiguous checkout retries original API credential after rotation');
    $check($retried->pending_secret_key === null, 'pending key removed after retry resolves');
    $providerBehavior = 'error';
    try {
        $stripe->checkout($user, 60000, 'stripe-error-006');
        $check(false, 'known provider error rejects checkout');
    } catch (HttpException $error) {
        $check(! str_contains($error->getMessage(), 'sk_test_'), 'provider response errors are redacted');
    }
    $knownFailure = StripePayment::where('amount', 60000)->firstOrFail();
    $check($knownFailure->status === 'failed' && $knownFailure->pending_secret_key === null, 'known provider rejection closes checkout and clears key');
    $reject(fn () => $stripe->checkout($user, 60000, 'stripe-error-006'), 'failed checkout cannot recreate provider request');
    $providerBehavior = 'unsafe_url';
    $reject(fn () => $stripe->checkout($user, 70000, 'stripe-bad-url-007'), 'unexpected provider redirect host rejected', 503);
    $check(StripePayment::where('amount', 70000)->value('session_id') === null, 'untrusted checkout URL is not stored');
    $providerBehavior = 'wrong_currency';
    $reject(fn () => $stripe->checkout($user, 75000, 'stripe-bad-currency-007'), 'NGN provider response cannot create a USD checkout', 503);
    $check(StripePayment::where('amount', 75000)->value('session_id') === null, 'provider currency mismatch is not saved as a usable checkout');
    $providerBehavior = 'unavailable';
    $reject(fn () => $stripe->checkout($user, 80000, 'stripe-outage-008'), 'provider outage is retryable', 503);
    $oldAmbiguous = StripePayment::where('amount', 80000)->firstOrFail();
    Carbon::setTestNow(now()->addHours(24));
    $secretVersionBeforePrune = $settings->current()->version;
    Artisan::call('edge:payments-prune-secrets');
    $check($oldAmbiguous->fresh()->pending_secret_key === null && $oldAmbiguous->fresh()->pending_payload === null, 'scheduled cleanup removes expired pending credential snapshots');
    $check($oldAmbiguous->fresh()->status === 'pending', 'cleanup preserves ambiguous payment state for reconciliation');
    $check($settings->current()->previous_webhook_secrets === [], 'cleanup removes expired signing key rollover snapshots');
    $check($settings->current()->version === $secretVersionBeforePrune, 'internal cleanup does not invalidate admin configuration version');
    $callsBefore = count($providerCalls);
    $reject(fn () => $stripe->checkout($user, 80000, 'stripe-outage-008'), 'expired provider idempotency window cannot recreate checkout');
    $check(count($providerCalls) === $callsBefore, 'old ambiguous checkout never calls Stripe again');
    $check($oldAmbiguous->fresh()->pending_secret_key === null, 'old ambiguous credential snapshot removed');
    $providerBehavior = 'success';

    $deposit = $manual->create($user, 'deposit', 10000, 'bank_transfer', ['reference' => 'manual-test-reference'], 'manual-deposit-001');
    $check($deposit->details['payment_destination']['account_number'] === '0123456789', 'manual request stores server-owned bank destination snapshot');
    $update(['manual_account_number' => '9876543210']);
    $check($deposit->fresh()->details['payment_destination']['account_number'] === '0123456789', 'bank changes preserve existing payment instructions');
    $check($manual->create($user, 'deposit', 10000, 'bank_transfer', ['reference' => 'manual-test-reference'], 'manual-deposit-001')->id === $deposit->id, 'bank changes do not break request idempotency');
    $update(['manual_enabled' => false]);
    $reject(fn () => $manual->create($user, 'deposit', 10000, 'bank_transfer', ['reference' => 'blocked-manual'], 'manual-blocked-002'), 'disabled manual deposits rejected');
    $withdrawal = $manual->create($user, 'withdrawal', 10000, 'bank', ['bank_name' => 'Member bank', 'account_name' => 'Member account', 'account_number' => '0123456789'], 'manual-withdraw-001');
    $check($withdrawal->status === 'pending', 'manual withdrawal remains available when manual deposits disabled');
    $beforeReview = $user->fresh()->wallet_balance;
    $manual->review($deposit, true, $admin, 'TEST-BANK-UNIQUE-001');
    $check($user->fresh()->wallet_balance === $beforeReview + 10000, 'existing manual deposit remains reviewable after method disabled');
    $update(['stripe_enabled' => false]);
    $reject(fn () => $stripe->checkout($user, 10000, 'disabled-new-card-999'), 'disabling Stripe blocks new deposits');
    $deliver($event($retried, 'evt_InFlightAfterDisable'));
    $check($retried->fresh()->status === 'paid', 'disabling method does not lose an existing paid checkout');

    $app['env'] = 'production';
    $reject(fn () => $update(['stripe_enabled' => true]), 'production rejects enabling Stripe test mode');
    $reject(fn () => $deliver($event($first, 'evt_ProductionTestCredit')), 'production refuses sandbox wallet credit', 400);
    $check($settings->current()->stripe_enabled === false, 'failed production configuration does not change settings');
    $app['env'] = 'testing';
    $check(DB::table('stripe_webhook_events')->where('event_id', 'evt_ProductionTestCredit')->doesntExist(), 'rejected sandbox event not marked processed');
    $check($settings->publicMethods()['stripe']['publishable_key'] === null, 'disabled public card method omits publishable key');
    echo "PASS: {$count} payment service integration checks (isolated SQLite; Stripe HTTP faked).\n";
} finally {
    Carbon::setTestNow();
    DB::disconnect('sqlite');
    @unlink($path);
    @unlink($path.'-wal');
    @unlink($path.'-shm');
}
