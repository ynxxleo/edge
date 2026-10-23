<?php

namespace App\Services;

use App\Models\AdminAudit;
use App\Models\AdminWalletTopup;
use App\Models\User;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;

class AdminTopupService
{
    public function __construct(private WalletService $wallet) {}

    public static function rules(): array
    {
        return [
            'account_number' => ['required', 'string', 'regex:/\A[1-9][0-9]{9}\z/D'],
            'amount_cents' => ['required', 'integer', 'min:100', 'max:'.StakingRules::MAX_AMOUNT],
            'reason' => ['required', 'string', 'min:3', 'max:300', 'regex:/\A[^\p{C}]*\z/u'],
            'current_password' => ['required', 'string', 'max:128'],
            'confirmed' => ['required', 'accepted'],
            'idempotency_key' => ['required', 'string', 'min:16', 'max:100', 'regex:/\A[A-Za-z0-9_-]+\z/D'],
        ];
    }

    public function credit(User $admin, User $user, array $input): array
    {
        StakingRules::admin($admin);
        if (isset($input['reason']) && is_string($input['reason'])) {
            $input['reason'] = trim($input['reason']);
        }
        $input = Validator::make($input, self::rules())->validate();
        $amount = (int) $input['amount_cents'];
        $hash = hash('sha256', json_encode([$user->id, $input['account_number'], $amount, $input['reason']], JSON_THROW_ON_ERROR));
        $reference = StakingRules::reference('admin-topup', $admin, $input['idempotency_key']);

        return StakingTransaction::run(function () use ($admin, $user, $input, $amount, $hash, $reference) {
            $users = User::whereIn('id', [$admin->id, $user->id])->orderBy('id')->lockForUpdate()->get();
            $actor = $users->firstWhere('id', $admin->id);
            abort_unless($actor?->is_admin, 403, 'Administrator access is required.');
            if (! Hash::check($input['current_password'], $actor->password)) {
                StakingRules::fail('current_password', 'Your current administrator password is incorrect.');
            }
            $existing = AdminWalletTopup::where('reference', $reference)->first();
            if ($existing) {
                abort_unless(hash_equals($existing->request_hash, $hash), 409, 'This request key was already used for different top-up details.');
                return ['topup' => $existing, 'idempotent' => true];
            }
            $recipient = $users->firstWhere('id', $user->id);
            abort_unless($recipient, 404);
            if ($recipient->internal_account_number !== $input['account_number']) {
                StakingRules::fail('account_number', 'The selected account changed. Search for the user and confirm again.');
            }
            $before = $recipient->wallet_balance;
            $transaction = $this->wallet->credit($recipient, $amount, 'admin_topup', $reference, ['source' => 'administrator_topup']);
            $topup = AdminWalletTopup::create([
                'reference' => $reference, 'user_id' => $recipient->id, 'admin_id' => $actor->id,
                'wallet_transaction_id' => $transaction->id, 'amount' => $amount,
                'balance_before' => $before, 'balance_after' => $transaction->balance_after,
                'reason' => $input['reason'], 'request_hash' => $hash, 'created_at' => now(),
            ]);
            // Free-text reasons are encrypted in the receipt, never copied to user ledgers or the general audit feed.
            AdminAudit::create([
                'actor_id' => $actor->id, 'action' => 'wallet.admin_topup', 'subject_type' => 'AdminWalletTopup', 'subject_id' => $topup->id,
                'before' => ['user_id' => $recipient->id, 'balance_cents' => $before],
                'after' => ['reference' => $reference, 'user_id' => $recipient->id, 'amount_cents' => $amount, 'balance_cents' => $transaction->balance_after],
                'reason' => null,
            ]);
            return ['topup' => $topup, 'idempotent' => false];
        });
    }
}
