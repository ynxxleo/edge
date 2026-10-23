<?php

namespace App\Services;

use App\Models\User;
use App\Models\WalletTransfer;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Hash;

class TransferService
{
    public function __construct(private WalletService $wallet) {}

    public static function recipientData(User $user): array
    {
        $parts = preg_split('/\s+/u', trim($user->name));
        $name = array_shift($parts);
        if ($parts) {
            $name .= ' '.mb_substr(end($parts), 0, 1).'.';
        }
        return ['name' => $name, 'account_number' => $user->internal_account_number];
    }

    public function preview(User $sender, string $number): array
    {
        $recipient = User::where('internal_account_number', $number)->first();
        if (! $recipient || $recipient->id === $sender->id) {
            StakingRules::fail('account_number', 'Enter another EDGE user’s valid account number.');
        }
        return ['recipient' => self::recipientData($recipient), 'confirmation_token' => Crypt::encryptString(json_encode([
            'sender_id' => $sender->id, 'recipient_id' => $recipient->id,
            'account_number' => $number, 'expires_at' => now()->addMinutes(10)->timestamp,
        ], JSON_THROW_ON_ERROR))];
    }

    public function send(User $sender, string $number, int $amount, string $token, string $password, string $key): WalletTransfer
    {
        StakingRules::amount($amount, 'amount_cents');
        $reference = StakingRules::reference('transfer', $sender, $key);
        $hash = hash('sha256', json_encode([$number, $amount]));
        return StakingTransaction::run(function () use ($sender, $number, $amount, $token, $password, $reference, $hash) {
            // Both rows are locked in ID order, including opposite-direction transfers.
            $users = User::where('id', $sender->id)->orWhere('internal_account_number', $number)->orderBy('id')->lockForUpdate()->get();
            $locked = $users->firstWhere('id', $sender->id);
            if (! $locked || ! Hash::check($password, $locked->password)) {
                StakingRules::fail('current_password', 'Your current password is incorrect.');
            }
            $existing = WalletTransfer::where('reference', $reference)->first();
            if ($existing) {
                if (! hash_equals($existing->request_hash, $hash)) {
                    StakingRules::fail('idempotency_key', 'This request key was used for different transfer details.');
                }
                return $existing;
            }
            $recipient = $users->firstWhere('internal_account_number', $number);
            if (! $recipient || $recipient->id === $locked->id) {
                StakingRules::fail('account_number', 'Enter another EDGE user’s valid account number.');
            }
            if (app(KycService::class)->summary($locked)['status'] !== 'approved') {
                StakingRules::fail('kyc', 'Administrator-approved identity verification is required before sending a transfer.');
            }
            try {
                $confirmation = json_decode(Crypt::decryptString($token), true, 512, JSON_THROW_ON_ERROR);
            } catch (\Throwable) {
                StakingRules::fail('confirmation_token', 'Confirm the recipient again before sending.');
            }
            if (($confirmation['sender_id'] ?? null) !== $locked->id || ($confirmation['recipient_id'] ?? null) !== $recipient->id || ($confirmation['account_number'] ?? null) !== $number || ($confirmation['expires_at'] ?? 0) <= now()->timestamp) {
                StakingRules::fail('confirmation_token', 'The recipient confirmation expired or changed. Confirm the recipient again.');
            }
            $transfer = WalletTransfer::create(['reference' => $reference, 'sender_id' => $locked->id, 'recipient_id' => $recipient->id, 'amount' => $amount, 'request_hash' => $hash, 'created_at' => now()]);
            $this->wallet->debit($locked, $amount, 'transfer_out', $reference.'-out', ['transfer_reference' => $reference, 'counterparty' => self::recipientData($recipient)]);
            $this->wallet->credit($recipient, $amount, 'transfer_in', $reference.'-in', ['transfer_reference' => $reference, 'counterparty' => self::recipientData($locked)]);
            return $transfer;
        });
    }
}
