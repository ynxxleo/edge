<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PromoCode extends Model
{
    protected $guarded = [];

    protected $hidden = ['encrypted_code', 'code_hash', 'issuance_key_hash', 'request_hash'];

    protected function casts(): array
    {
        return [
            'amount' => 'integer', 'version' => 'integer', 'encrypted_code' => 'encrypted',
            'created_by' => 'integer', 'redeemed_by' => 'integer', 'revoked_by' => 'integer',
            'expires_at' => 'immutable_datetime', 'redeemed_at' => 'immutable_datetime', 'revoked_at' => 'immutable_datetime',
        ];
    }

    protected static function booted(): void
    {
        static::updating(function (self $code): void {
            if ($code->getRawOriginal('status') !== 'active') {
                throw new \LogicException('Used or revoked promotional codes are immutable.');
            }
            $allowed = ['status', 'version', 'redeemed_by', 'redeemed_at', 'revoked_by', 'revoked_at', 'updated_at'];
            if (array_diff(array_keys($code->getDirty()), $allowed) || ! in_array($code->status, ['redeemed', 'revoked'], true)) {
                throw new \LogicException('Promotional credit terms cannot be changed after issuance.');
            }
            if ($code->version !== (int) $code->getRawOriginal('version') + 1) {
                throw new \LogicException('Promotional code transitions require the next version.');
            }
            if ($code->status === 'redeemed' && (! $code->redeemed_by || ! $code->redeemed_at || $code->revoked_by || $code->revoked_at)) {
                throw new \LogicException('A redeemed promotional code requires its redemption record.');
            }
            if ($code->status === 'revoked' && (! $code->revoked_by || ! $code->revoked_at || $code->redeemed_by || $code->redeemed_at)) {
                throw new \LogicException('A revoked promotional code requires its revocation record.');
            }
        });
        static::deleting(fn () => throw new \LogicException('Promotional credit history cannot be deleted.'));
    }

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function redeemer()
    {
        return $this->belongsTo(User::class, 'redeemed_by');
    }

    public function redemption()
    {
        return $this->hasOne(PromoCodeRedemption::class);
    }
}
