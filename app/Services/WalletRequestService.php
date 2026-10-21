<?php

namespace App\Services;

use App\Models\User;
use App\Models\WalletRequest;
use Illuminate\Support\Facades\DB;

class WalletRequestService
{
    public function __construct(private WalletService $wallet) {}

    public function create(User $user, string $type, int $amount, string $method, array $details, string $idempotencyKey): WalletRequest
    {
        StakingRules::amount($amount);
        if (! in_array($type, ['deposit', 'withdrawal'], true) || strlen($method) < 2 || strlen($method) > 80) {
            StakingRules::fail('type', 'Choose a deposit or withdrawal and a valid payment method.');
        }
        $reference = StakingRules::reference('request', $user, $idempotencyKey);
        $hash = hash('sha256', json_encode([$type, $amount, $method, $details]));
        return StakingTransaction::run(function () use ($user, $type, $amount, $method, $details, $reference, $hash) {
            User::lockForUpdate()->findOrFail($user->id);
            $existing = WalletRequest::where('reference', $reference)->first();
            if ($existing) {
                if (! hash_equals($existing->request_hash, $hash)) {
                    StakingRules::fail('idempotency_key', 'This request key has already been used for different payment details.');
                }
                return $existing;
            }
            if ($type === 'withdrawal') {
                app(KycService::class)->assertWithdrawalApproved($user);
            }
            $custom = str_starts_with($method, 'manual:');
            if ($custom) {
                if (! preg_match('/\Amanual:[1-9][0-9]*\z/D', $method)) StakingRules::fail('method', 'Choose a valid manual payment method.');
                $details = app(ManualPaymentMethodService::class)->requestDetails($method, $type, $details);
            } elseif (\App\Models\ManualPaymentMethod::exists()) {
                StakingRules::fail('method', 'Choose one of the configured payment methods.');
            }
            if ($type === 'deposit' && ! $custom) {
                $destination = app(PaymentSettingsService::class)->publicMethods()['manual'];
                if (! $destination['enabled']) {
                    StakingRules::fail('method', 'Manual deposits are currently unavailable.');
                }
                // Customers cannot choose or replace the receiving bank details.
                $details['payment_destination'] = collect($destination)->only('bank_name', 'account_name', 'account_number', 'instructions', 'reference_label', 'support_contact')->all();
            }
            $request = WalletRequest::create(['user_id' => $user->id, 'reference' => $reference, 'request_hash' => $hash, 'type' => $type, 'amount' => $amount, 'method' => $method, 'details' => $custom ? [] : $details, 'manual_details' => $custom ? $details : null, 'status' => 'pending']);
            if ($type === 'withdrawal') {
                $this->wallet->debit($user, $amount, 'withdrawal', 'reserve-'.$reference, ['wallet_request_id' => $request->id]);
            }
            return $request;
        }, 5);
    }

    public function review(WalletRequest $request, bool $approved, User $admin, ?string $adminReference = null): WalletRequest
    {
        StakingRules::admin($admin);
        $adminReference = $adminReference === null ? null : trim($adminReference);
        return StakingTransaction::run(function () use ($request, $approved, $admin, $adminReference) {
            $request = WalletRequest::lockForUpdate()->findOrFail($request->id);
            $status = $approved ? 'approved' : 'rejected';
            if ($request->status !== 'pending') {
                if ($request->status === $status) {
                    return $request;
                }
                StakingRules::fail('status', 'This payment request has already been reviewed.');
            }
            if ($approved && (strlen(trim($adminReference ?? '')) < 3 || strlen($adminReference) > 160)) {
                StakingRules::fail('admin_reference', 'Approval requires a unique bank or payment provider transaction reference.');
            }
            if ($approved && WalletRequest::where('admin_reference', $adminReference)->exists()) {
                StakingRules::fail('admin_reference', 'This bank or provider reference has already been used.');
            }
            $before = $request->toArray();
            if ($approved && $request->type === 'deposit') {
                $this->wallet->credit($request->user, $request->amount, 'deposit', 'deposit-'.$request->reference, ['wallet_request_id' => $request->id, 'provider_reference' => $adminReference]);
            } elseif (! $approved && $request->type === 'withdrawal') {
                $this->wallet->credit($request->user, $request->amount, 'refund', 'rejected-'.$request->reference, ['wallet_request_id' => $request->id]);
            }
            $request->fill(['status' => $status, 'admin_reference' => $approved ? $adminReference : null, 'review_note' => $approved ? null : $adminReference, 'reviewed_by' => $admin->id, 'reviewed_at' => now()])->save();
            StakingRules::audit($admin, 'wallet.'.$status, $request, $before, $approved ? null : $adminReference);
            return $request;
        }, 5);
    }
}
