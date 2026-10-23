<?php

namespace App\Services;

use App\Models\User;
use App\Models\WalletTransaction;
use Illuminate\Support\Facades\DB;

class WalletService
{
    public function credit(User $user, int $amount, string $type, string $reference, array $metadata = []): WalletTransaction
    {
        if ($amount <= 0) {
            StakingRules::fail('amount', 'Credit amount must be positive.');
        }
        return $this->move($user, $amount, $type, $reference, $metadata);
    }

    public function debit(User $user, int $amount, string $type, string $reference, array $metadata = []): WalletTransaction
    {
        if ($amount <= 0) {
            StakingRules::fail('amount', 'Debit amount must be positive.');
        }
        return $this->move($user, -$amount, $type, $reference, $metadata);
    }

    private function move(User $user, int $signedAmount, string $type, string $reference, array $metadata): WalletTransaction
    {
        if ($signedAmount === 0 || strlen($reference) > 120 || ! in_array($type, ['deposit', 'promo_credit', 'stake', 'payout', 'withdrawal', 'refund', 'copy_allocation', 'copy_return', 'transfer_in', 'transfer_out', 'admin_topup'], true) || (in_array($type, ['promo_credit', 'transfer_in', 'admin_topup'], true) && $signedAmount < 0) || ($type === 'transfer_out' && $signedAmount > 0)) {
            StakingRules::fail('amount', 'Invalid wallet transaction.');
        }
        return StakingTransaction::run(function () use ($user, $signedAmount, $type, $reference, $metadata) {
            $locked = User::lockForUpdate()->findOrFail($user->id);
            $existing = WalletTransaction::where('reference', $reference)->first();
            if ($existing) {
                if ($existing->user_id !== $user->id || $existing->amount !== $signedAmount || $existing->type !== $type) {
                    StakingRules::fail('reference', 'This payment reference has already been used for a different transaction.');
                }
                return $existing;
            }
            $balance = $locked->wallet_balance + $signedAmount;
            if ($balance < 0) {
                StakingRules::fail('amount', 'Your available wallet balance is too low.');
            }
            if ($balance > StakingRules::MAX_PAYOUT * 100) {
                StakingRules::fail('amount', 'The wallet balance limit would be exceeded.');
            }
            $locked->wallet_balance = $balance;
            $locked->save();
            return WalletTransaction::create([
                'user_id' => $locked->id, 'type' => $type, 'reference' => $reference,
                'amount' => $signedAmount, 'balance_after' => $balance, 'metadata' => $metadata,
            ]);
        }, 5);
    }
}
