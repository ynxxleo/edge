<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AdminAudit extends Model
{
    protected $guarded = [];

    protected static function booted(): void
    {
        static::updating(fn () => throw new \LogicException('Financial ledger and audit records are immutable.'));
        static::deleting(fn () => throw new \LogicException('Financial ledger and audit records cannot be deleted.'));
    }

    protected function casts(): array
    {
        return ['before' => 'array', 'after' => 'array'];
    }

    public function actor()
    {
        return $this->belongsTo(User::class, 'actor_id');
    }
}
