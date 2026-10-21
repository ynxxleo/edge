<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class StripePayment extends Model
{
    protected $guarded = [];

    protected $hidden = ['pending_secret_key', 'pending_payload', 'request_hash'];

    protected function casts(): array
    {
        return ['amount' => 'integer', 'pending_secret_key' => 'encrypted', 'pending_payload' => 'encrypted:array', 'paid_at' => 'datetime'];
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function publicData(): array
    {
        return [
            'reference' => $this->reference, 'status' => $this->status, 'amount_cents' => $this->amount,
            'currency' => $this->currency, 'mode' => $this->mode, 'session_id' => $this->session_id,
            'created_at' => $this->created_at?->toIso8601String(), 'paid_at' => $this->paid_at?->toIso8601String(),
        ];
    }
}
