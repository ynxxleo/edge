<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PromoCodeRedemption extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'amount' => 'integer', 'redeemed_at' => 'immutable_datetime',
            'promo_code_id' => 'integer', 'user_id' => 'integer', 'wallet_transaction_id' => 'integer',
        ];
    }

    protected static function booted(): void
    {
        static::updating(fn () => throw new \LogicException('Promotional redemptions are immutable.'));
        static::deleting(fn () => throw new \LogicException('Promotional redemptions cannot be deleted.'));
    }

    public function promoCode()
    {
        return $this->belongsTo(PromoCode::class);
    }

    public function transaction()
    {
        return $this->belongsTo(WalletTransaction::class, 'wallet_transaction_id');
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
