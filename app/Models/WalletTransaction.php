<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class WalletTransaction extends Model
{
    protected $guarded = [];

    protected static function booted(): void
    {
        static::updating(fn () => throw new \LogicException('Financial ledger and audit records are immutable.'));
        static::deleting(fn () => throw new \LogicException('Financial ledger and audit records cannot be deleted.'));
    }

    protected function casts(): array
    {
        return ['amount' => 'integer', 'balance_after' => 'integer', 'metadata' => 'array'];
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
