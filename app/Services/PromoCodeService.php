<?php

namespace App\Services;

use App\Models\AdminAudit;
use App\Models\PromoCode;
use App\Models\PromoCodeRedemption;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

class PromoCodeService
{
    public static function issueRules(): array
    {
        return [
            'amount_cents' => ['required', 'integer', 'min:100', 'max:'.StakingRules::MAX_AMOUNT],
            'label' => ['sometimes', 'nullable', 'string', 'max:100', 'regex:/\A[^\p{C}]*\z/u'],
            // An explicit zone prevents a browser's local time from changing the expiration.
            'expires_at' => ['sometimes', 'nullable', 'string', 'max:40', 'date', 'regex:/\A\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})\z/D'],
            'current_password' => ['required', 'string', 'max:128'],
            'idempotency_key' => ['required', 'string', 'min:16', 'max:100', 'regex:/\A[A-Za-z0-9_-]+\z/D'],
        ];
    }

    public static function revokeRules(): array
    {
        return ['version' => ['required', 'integer', 'min:1'], 'current_password' => ['required', 'string', 'max:128']];
    }

    public static function redeemRules(): array
    {
        return ['code' => ['required', 'string', 'max:80']];
    }

    public function issue(User $admin, array $input): array
    {
        StakingRules::admin($admin);
        if (isset($input['label']) && is_string($input['label'])) {
            $input['label'] = trim($input['label']) ?: null;
        }
        $input = $this->validate($input, self::issueRules());
        $expires = filled($input['expires_at'] ?? null) ? CarbonImmutable::parse($input['expires_at'])->utc()->startOfSecond() : null;
        $terms = ['amount_cents' => (int) $input['amount_cents'], 'label' => $input['label'] ?? null, 'expires_at' => $expires?->toIso8601String()];
        $requestHash = hash('sha256', json_encode($terms, JSON_THROW_ON_ERROR));
        $keyHash = hash('sha256', $input['idempotency_key']);

        return StakingTransaction::run(function () use ($admin, $input, $terms, $expires, $requestHash, $keyHash): array {
            // Serialize issuance keys per administrator before reading the unique key.
            $actor = User::lockForUpdate()->findOrFail($admin->id);
            $this->checkAdministrator($actor, $input['current_password']);
            $existing = PromoCode::where('created_by', $actor->id)->where('issuance_key_hash', $keyHash)->first();
            if ($existing) {
                abort_unless(hash_equals($existing->request_hash, $requestHash), 409, 'This request key has already been used for different promotional credit terms.');

                return ['promo_code' => $existing, 'code' => $existing->encrypted_code, 'idempotent' => true];
            }
            if ($expires && ! $expires->isFuture()) {
                StakingRules::fail('expires_at', 'Choose a future expiration time.');
            }
            $currency = StakingCurrency::code(true);
            do {
                $plaintext = $this->generateCode();
                $codeHash = hash('sha256', $plaintext);
            } while (PromoCode::where('code_hash', $codeHash)->exists());
            $code = PromoCode::create([
                'created_by' => $actor->id, 'issuance_key_hash' => $keyHash, 'request_hash' => $requestHash,
                'encrypted_code' => $plaintext, 'code_hash' => $codeHash, 'code_last4' => substr($plaintext, -4),
                'amount' => $terms['amount_cents'], 'currency' => $currency, 'label' => $terms['label'],
                'status' => 'active', 'version' => 1, 'expires_at' => $expires,
            ]);
            $this->audit($actor, 'promo_code.issued', $code, null);

            return ['promo_code' => $code, 'code' => $plaintext, 'idempotent' => false];
        });
    }

    public function revoke(PromoCode $code, User $admin, array $input): PromoCode
    {
        StakingRules::admin($admin);
        $input = $this->validate($input, self::revokeRules());

        return StakingTransaction::run(function () use ($code, $admin, $input): PromoCode {
            // Always lock the actor before the code, matching redemption's lock order.
            $actor = User::lockForUpdate()->findOrFail($admin->id);
            $this->checkAdministrator($actor, $input['current_password']);
            $locked = PromoCode::lockForUpdate()->findOrFail($code->id);
            if ($locked->status === 'revoked') {
                // An exact version retry is safe after a response is lost.
                abort_unless((int) $input['version'] === $locked->version - 1 || (int) $input['version'] === $locked->version, 409, 'This promotional code changed. Refresh before continuing.');

                return $locked;
            }
            abort_unless($locked->status === 'active', 409, 'Redeemed promotional credit cannot be revoked.');
            abort_unless((int) $input['version'] === $locked->version, 409, 'This promotional code changed. Refresh before continuing.');
            $before = $this->auditData($locked);
            $locked->status = 'revoked';
            $locked->version++;
            $locked->revoked_by = $actor->id;
            $locked->revoked_at = now();
            $locked->save();
            $this->audit($actor, 'promo_code.revoked', $locked, $before);

            return $locked;
        });
    }

    public function redeem(User $user, array $input): array
    {
        $input = $this->validate($input, self::redeemRules());
        $plaintext = strtoupper(trim($input['code']));
        if (! preg_match('/\A[A-Z0-9]{16}\z/D', $plaintext)) {
            $this->unavailable();
        }
        $codeHash = hash('sha256', $plaintext);

        return StakingTransaction::run(function () use ($user, $codeHash): array {
            $owner = User::lockForUpdate()->findOrFail($user->id);
            $code = PromoCode::where('code_hash', $codeHash)->lockForUpdate()->first();
            if (! $code) {
                $this->unavailable();
            }
            if ($code->status === 'redeemed') {
                if ($code->redeemed_by !== $owner->id) {
                    $this->unavailable();
                }
                $redemption = PromoCodeRedemption::where('promo_code_id', $code->id)->where('user_id', $owner->id)->firstOrFail();

                return ['redemption' => $redemption, 'already_redeemed' => true, 'wallet_balance_cents' => $owner->wallet_balance];
            }
            if ($code->status !== 'active' || ($code->expires_at && ! $code->expires_at->isFuture()) || $code->currency !== StakingCurrency::code()) {
                $this->unavailable();
            }
            $transaction = app(WalletService::class)->credit($owner, $code->amount, 'promo_credit', 'promo-code-'.$code->id, [
                'promo_code_id' => $code->id, 'currency' => $code->currency,
            ]);
            $redemption = PromoCodeRedemption::create([
                'promo_code_id' => $code->id, 'user_id' => $owner->id, 'wallet_transaction_id' => $transaction->id,
                'amount' => $code->amount, 'currency' => $code->currency, 'redeemed_at' => now(),
            ]);
            $before = $this->auditData($code);
            $code->status = 'redeemed';
            $code->version++;
            $code->redeemed_by = $owner->id;
            $code->redeemed_at = $redemption->redeemed_at;
            $code->save();
            $this->audit($owner, 'promo_code.redeemed', $code, $before);

            return ['redemption' => $redemption, 'already_redeemed' => false, 'wallet_balance_cents' => $transaction->balance_after];
        });
    }

    public function status(PromoCode $code): string
    {
        return $code->status === 'active' && $code->expires_at && ! $code->expires_at->isFuture() ? 'expired' : $code->status;
    }

    public function adminData(PromoCode $code): array
    {
        $code->loadMissing(['creator', 'redeemer']);

        return [
            'id' => $code->id, 'code_last4' => $code->code_last4, 'display_code' => '•••• •••• •••• '.$code->code_last4,
            'amount_cents' => $code->amount, 'currency' => $code->currency, 'label' => $code->label,
            'status' => $this->status($code), 'version' => $code->version,
            'created_at' => $code->created_at?->toIso8601String(), 'expires_at' => $code->expires_at?->toIso8601String(),
            'redeemed_at' => $code->redeemed_at?->toIso8601String(), 'revoked_at' => $code->revoked_at?->toIso8601String(),
            'created_by' => $this->accountData($code->creator), 'redeemed_by' => $this->accountData($code->redeemer),
        ];
    }

    public function redemptionData(PromoCodeRedemption $redemption): array
    {
        $redemption->loadMissing(['promoCode', 'transaction']);

        return [
            'id' => $redemption->id, 'promo_code_id' => $redemption->promo_code_id,
            'code_last4' => $redemption->promoCode->code_last4, 'amount_cents' => $redemption->amount,
            'currency' => $redemption->currency, 'label' => $redemption->promoCode->label,
            'redeemed_at' => $redemption->redeemed_at?->toIso8601String(),
            'transaction_id' => $redemption->wallet_transaction_id, 'reference' => $redemption->transaction->reference,
            'balance_after' => $redemption->transaction->balance_after,
        ];
    }

    private function validate(array $input, array $rules): array
    {
        $unknown = array_diff(array_keys($input), array_keys($rules));
        if ($unknown) {
            throw ValidationException::withMessages(array_fill_keys($unknown, ['This field is not accepted.']));
        }

        return Validator::make($input, $rules)->validate();
    }

    private function checkAdministrator(User $admin, string $password): void
    {
        StakingRules::admin($admin);
        if (! Hash::check($password, $admin->getAuthPassword())) {
            StakingRules::fail('current_password', 'Your current administrator password is incorrect.');
        }
    }

    private function generateCode(): string
    {
        $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        do {
            $code = '';
            for ($index = 0; $index < 16; $index++) {
                $code .= $alphabet[random_int(0, 35)];
            }
        } while (! preg_match('/[A-Z]/', $code) || ! preg_match('/[0-9]/', $code));

        return $code;
    }

    private function unavailable(): never
    {
        StakingRules::fail('code', 'This promotional code is unavailable. Check the code or contact support.');
    }

    private function accountData(?User $user): ?array
    {
        return $user ? ['id' => $user->id, 'name' => $user->name, 'email' => $user->email] : null;
    }

    private function auditData(PromoCode $code): array
    {
        return ['promo_code_id' => $code->id, 'status' => $code->status, 'version' => $code->version, 'amount_cents' => $code->amount, 'currency' => $code->currency];
    }

    private function audit(User $actor, string $action, PromoCode $code, ?array $before): void
    {
        AdminAudit::create([
            'actor_id' => $actor->id, 'action' => $action, 'subject_type' => 'PromoCode',
            'subject_id' => $code->id, 'before' => $before, 'after' => $this->auditData($code),
        ]);
    }
}
