<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CopyStake extends Model
{
    protected $guarded = [];

    protected static function booted(): void
    {
        static::updating(function (self $record) {
            if ($record->isDirty(['copy_position_id', 'copy_pick_id', 'stake', 'odds'])) {
                throw new \LogicException('Accepted stake details and odds are immutable.');
            }
        });
    }

    protected function casts(): array
    {
        return ['stake' => 'integer', 'payout' => 'integer', 'odds' => 'decimal:4', 'settled_at' => 'datetime'];
    }

    public function position()
    {
        return $this->belongsTo(CopyPosition::class, 'copy_position_id');
    }

    public function pick()
    {
        return $this->belongsTo(CopyPick::class, 'copy_pick_id');
    }
}
