<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AdminWalletTopup extends Model
{
    public $timestamps = false;
    protected $guarded = [];

    protected function casts(): array
    {
        return ['amount' => 'integer', 'balance_before' => 'integer', 'balance_after' => 'integer', 'reason' => 'encrypted', 'created_at' => 'datetime'];
    }

    protected static function booted(): void
    {
        static::updating(fn () => throw new \LogicException('Top-up receipts are immutable.'));
        static::deleting(fn () => throw new \LogicException('Top-up receipts cannot be deleted.'));
    }

    public function user() { return $this->belongsTo(User::class); }
    public function admin() { return $this->belongsTo(User::class, 'admin_id'); }

    public function adminData(): array
    {
        return [
            'reference' => $this->reference, 'amount_cents' => $this->amount, 'currency' => 'USD',
            'balance_before_cents' => $this->balance_before, 'balance_after_cents' => $this->balance_after,
            'reason' => $this->reason, 'created_at' => $this->created_at->toIso8601String(),
            'user' => ['id' => $this->user_id, 'name' => $this->user->name, 'email' => $this->user->email, 'account_number' => $this->user->internal_account_number],
            'admin' => ['id' => $this->admin_id, 'name' => $this->admin->name],
        ];
    }
}
