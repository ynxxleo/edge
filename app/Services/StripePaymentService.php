<?php

namespace App\Services;

use App\Models\StripePayment;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Symfony\Component\HttpKernel\Exception\HttpException;

class StripePaymentService
{
    private const API_URL = 'https://api.stripe.com/v1/checkout/sessions';

    public function __construct(private PaymentSettingsService $settings, private WalletService $wallet) {}

    public function checkout(User $user, int $amount, string $key): StripePayment
    {
        if ($amount < 10000 || $amount > 99999999) {
            StakingRules::fail('amount_cents', 'Enter an amount between 100 and 999,999.99 '.StakingCurrency::code().'.');
        }
        $reference = StakingRules::reference('stripe', $user, $key);
        $payment = StakingTransaction::run(function () use ($user, $amount, $reference): StripePayment {
            User::lockForUpdate()->findOrFail($user->id);
            $currency = StakingCurrency::code(lockForUpdate: true);
            $hash = hash('sha256', json_encode([$user->id, $amount, $currency]));
            $existing = StripePayment::where('reference', $reference)->first();
            if ($existing) {
                if ($existing->currency !== $currency) {
                    StakingRules::fail('idempotency_key', 'This deposit uses a previous wallet currency. Contact support with its reference.');
                }
                if (! hash_equals($existing->request_hash, $hash)) {
                    StakingRules::fail('idempotency_key', 'This request key has already been used for a different card deposit.');
                }
                return $existing;
            }
            $settings = $this->settings->current();
            if (! $this->settings->publicMethods($settings)['stripe']['enabled']) {
                StakingRules::fail('method', 'Card deposits are currently unavailable. Choose manual transfer if available.');
            }
            if (app()->environment('production') && $settings->stripe_mode !== 'live') {
                StakingRules::fail('method', 'Stripe test payments cannot fund production wallets.');
            }
            $base = rtrim(config('app.url'), '/');
            $payload = [
                'payment_method_types' => ['card'], 'mode' => 'payment',
                'client_reference_id' => $reference,
                'metadata' => ['payment_reference' => $reference, 'user_id' => (string) $user->id],
                'customer_email' => $user->email,
                'line_items' => [[
                    'quantity' => 1,
                    'price_data' => ['currency' => strtolower($currency), 'unit_amount' => $amount, 'product_data' => ['name' => 'EDGE wallet deposit']],
                ]],
                'success_url' => $base.'/app?stripe_return=success&session_id={CHECKOUT_SESSION_ID}&payment_ref='.$reference.'#wallet',
                'cancel_url' => $base.'/app?stripe_return=cancel&payment_ref='.$reference.'#wallet',
            ];
            return StripePayment::create([
                'user_id' => $user->id, 'reference' => $reference, 'request_hash' => $hash,
                'amount' => $amount, 'currency' => $currency, 'mode' => $settings->stripe_mode, 'status' => 'pending',
                'pending_secret_key' => $settings->stripe_secret_key, 'pending_payload' => $payload,
            ]);
        });

        if ($payment->status === 'paid') {
            return $payment;
        }
        if (in_array($payment->status, ['failed', 'expired'], true)) {
            StakingRules::fail('idempotency_key', 'This card deposit has ended. Start a new deposit.');
        }
        if ($payment->session_id) {
            return $payment;
        }
        // Stripe retains idempotency keys for at least 24 hours. Never risk recreating
        // an ambiguous older request after that window has elapsed.
        if ($payment->created_at->lt(now()->subHours(23))) {
            $payment->update(['pending_secret_key' => null, 'pending_payload' => null]);
            StakingRules::fail('idempotency_key', 'This checkout needs reconciliation before retrying. Contact support with its reference.');
        }
        try {
            $response = Http::asForm()->withToken($payment->pending_secret_key)
                ->withHeaders(['Idempotency-Key' => $payment->reference, 'Stripe-Version' => '2025-06-30.basil'])
                ->withOptions(['allow_redirects' => false])->connectTimeout(5)->timeout(20)
                ->post(self::API_URL, $payment->pending_payload);
        } catch (\Throwable) {
            // Provider exception strings can contain request headers. Do not expose or log them.
            throw new HttpException(503, 'Stripe could not be reached. Retry this same deposit request shortly.');
        }
        if (! $response->successful()) {
            if ($response->clientError() && ! in_array($response->status(), [408, 409, 429], true)) {
                StakingTransaction::run(function () use ($payment): void {
                    $locked = StripePayment::lockForUpdate()->findOrFail($payment->id);
                    if (! $locked->session_id && $locked->status !== 'paid') {
                        $locked->update(['status' => 'failed', 'pending_secret_key' => null, 'pending_payload' => null]);
                    }
                });
            }
            throw new HttpException(503, 'Stripe could not start checkout. Check the payment settings or retry shortly.');
        }
        $session = $response->json();
        if (! is_array($session) || ! $this->checkoutMatches($session, $payment)) {
            throw new HttpException(503, 'Stripe returned an unexpected checkout response. Retry this same deposit request or contact support.');
        }
        return StakingTransaction::run(function () use ($payment, $session): StripePayment {
            $locked = StripePayment::lockForUpdate()->findOrFail($payment->id);
            if ($locked->session_id && $locked->session_id !== $session['id']) {
                throw new HttpException(409, 'This deposit is already associated with another checkout session.');
            }
            $locked->fill([
                'session_id' => $session['id'], 'checkout_url' => $session['url'],
                'pending_secret_key' => null, 'pending_payload' => null,
            ])->save();
            return $locked;
        });
    }

    private function checkoutMatches(array $session, StripePayment $payment): bool
    {
        $url = $session['url'] ?? null;
        return is_string($session['id'] ?? null)
            && preg_match('/^cs_'.$payment->mode.'_[A-Za-z0-9]+$/D', $session['id'])
            && is_string($url) && parse_url($url, PHP_URL_SCHEME) === 'https'
            && parse_url($url, PHP_URL_HOST) === 'checkout.stripe.com'
            && ! parse_url($url, PHP_URL_USER) && ! parse_url($url, PHP_URL_PORT)
            && ($session['mode'] ?? null) === 'payment'
            && ($session['livemode'] ?? null) === ($payment->mode === 'live')
            && ($session['amount_total'] ?? null) === $payment->amount
            && $payment->currency === StakingCurrency::code()
            && ($session['currency'] ?? null) === strtolower($payment->currency)
            && ($session['client_reference_id'] ?? null) === $payment->reference
            && ($session['metadata']['payment_reference'] ?? null) === $payment->reference
            && ($session['metadata']['user_id'] ?? null) === (string) $payment->user_id;
    }

    public function webhook(string $body, string $signature): array
    {
        if (strlen($body) > 1048576 || strlen($signature) > 8192 || ! $this->verifySignature($body, $signature)) {
            throw new HttpException(400, 'Invalid Stripe webhook signature.');
        }
        try {
            $event = json_decode($body, true, 32, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new HttpException(400, 'Invalid Stripe webhook payload.');
        }
        if (! is_array($event) || ! is_string($event['id'] ?? null) || ! preg_match('/^evt_[A-Za-z0-9]+$/D', $event['id'])
            || ! is_string($event['type'] ?? null) || strlen($event['type']) > 100 || ! is_bool($event['livemode'] ?? null)) {
            throw new HttpException(400, 'Invalid Stripe webhook event.');
        }
        $supported = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired'];
        if (! in_array($event['type'], $supported, true)) {
            return ['received' => true, 'ignored' => true];
        }
        $session = $event['data']['object'] ?? null;
        if (! is_array($session) || ($session['object'] ?? null) !== 'checkout.session' || ! is_string($session['id'] ?? null)) {
            throw new HttpException(400, 'Invalid Stripe checkout event.');
        }
        $canonicalHash = hash('sha256', json_encode($this->canonicalize($event), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR));
        return StakingTransaction::run(function () use ($event, $session, $canonicalHash): array {
            $existing = DB::table('stripe_webhook_events')->where('event_id', $event['id'])->first();
            if ($existing) {
                abort_unless(hash_equals($existing->payload_hash, $canonicalHash), 409, 'This Stripe event ID has already been processed with different data.');
                return ['received' => true, 'duplicate' => true];
            }
            $reference = $session['metadata']['payment_reference'] ?? null;
            if (! is_string($reference)) {
                throw new HttpException(400, 'Missing Stripe payment reference.');
            }
            $payment = StripePayment::where('reference', $reference)->lockForUpdate()->first();
            if (! $payment) {
                throw new HttpException(400, 'Unknown Stripe payment reference.');
            }
            // A webhook can arrive before the API response is committed. Ask Stripe
            // to retry; never bind an unknown session or acknowledge lost credit.
            if (! $payment->session_id) {
                throw new HttpException(409, 'Checkout session is not ready. Retry this event.');
            }
            if ($payment->session_id !== $session['id']
                || ($session['client_reference_id'] ?? null) !== $payment->reference
                || ($session['metadata']['user_id'] ?? null) !== (string) $payment->user_id
                || ($session['amount_total'] ?? null) !== $payment->amount
                || $payment->currency !== StakingCurrency::code(lockForUpdate: true)
                || ($session['currency'] ?? null) !== strtolower($payment->currency)
                || ($session['mode'] ?? null) !== 'payment'
                || ($session['livemode'] ?? null) !== ($payment->mode === 'live')
                || $event['livemode'] !== ($payment->mode === 'live')) {
                throw new HttpException(400, 'Stripe payment details do not match the stored deposit.');
            }
            $paidEvent = in_array($event['type'], ['checkout.session.completed', 'checkout.session.async_payment_succeeded'], true);
            if ($paidEvent && ($session['payment_status'] ?? null) === 'paid') {
                if (app()->environment('production') && $payment->mode !== 'live') {
                    throw new HttpException(400, 'Stripe test payments cannot fund production wallets.');
                }
                $intent = $session['payment_intent'] ?? null;
                if (($session['status'] ?? null) !== 'complete' || ! is_string($intent) || ! preg_match('/^pi_[A-Za-z0-9]+$/D', $intent)) {
                    throw new HttpException(400, 'Stripe payment confirmation is incomplete.');
                }
                if ($payment->payment_intent_id && $payment->payment_intent_id !== $intent) {
                    throw new HttpException(400, 'Stripe payment intent does not match.');
                }
                if (StripePayment::where('payment_intent_id', $intent)->where('id', '!=', $payment->id)->exists()) {
                    throw new HttpException(400, 'Stripe payment intent is already assigned to another deposit.');
                }
                if ($payment->status !== 'paid') {
                    $this->wallet->credit($payment->user, $payment->amount, 'deposit', 'stripe-'.$payment->reference, ['stripe_payment_reference' => $payment->reference, 'stripe_session_id' => $payment->session_id, 'mode' => $payment->mode]);
                    $payment->fill(['status' => 'paid', 'payment_intent_id' => $intent, 'paid_at' => now(), 'pending_secret_key' => null, 'pending_payload' => null])->save();
                }
            } elseif ($payment->status !== 'paid') {
                $status = match ($event['type']) {
                    'checkout.session.expired' => 'expired',
                    'checkout.session.async_payment_failed' => 'failed',
                    default => 'processing',
                };
                // Unpaid completion can precede payment confirmation, but cannot
                // reopen a checkout already marked failed or expired.
                if ($status !== 'processing' || ! in_array($payment->status, ['failed', 'expired'], true)) {
                    $payment->update(['status' => $status]);
                }
            }
            DB::table('stripe_webhook_events')->insert([
                'event_id' => $event['id'], 'payload_hash' => $canonicalHash, 'stripe_payment_id' => $payment->id,
                'type' => $event['type'], 'created_at' => now(), 'updated_at' => now(),
            ]);
            return ['received' => true];
        });
    }

    private function verifySignature(string $body, string $header): bool
    {
        $timestamp = null;
        $signatures = [];
        foreach (explode(',', $header) as $part) {
            $pair = explode('=', trim($part), 2);
            if (count($pair) !== 2) {
                continue;
            }
            if ($pair[0] === 't' && preg_match('/^[0-9]{1,11}$/D', $pair[1])) {
                if ($timestamp !== null) {
                    return false;
                }
                $timestamp = (int) $pair[1];
            } elseif ($pair[0] === 'v1' && preg_match('/^[a-f0-9]{64}$/D', $pair[1])) {
                $signatures[] = $pair[1];
            }
        }
        if ($timestamp === null || abs(now()->timestamp - $timestamp) > 300 || ! $signatures) {
            return false;
        }
        $settings = $this->settings->current();
        $secrets = array_merge([$settings->stripe_webhook_secret], array_column(array_filter($settings->previous_webhook_secrets ?? [], fn ($item) => ($item['expires_at'] ?? 0) >= now()->timestamp), 'secret'));
        $valid = false;
        foreach ($secrets as $secret) {
            if (! is_string($secret) || $secret === '') {
                continue;
            }
            $expected = hash_hmac('sha256', $timestamp.'.'.$body, $secret);
            foreach ($signatures as $candidate) {
                $valid = hash_equals($expected, $candidate) || $valid;
            }
        }
        return $valid;
    }

    private function canonicalize(mixed $value): mixed
    {
        if (! is_array($value)) {
            return $value;
        }
        if (! array_is_list($value)) {
            ksort($value);
        }
        return array_map(fn ($item) => $this->canonicalize($item), $value);
    }
}
