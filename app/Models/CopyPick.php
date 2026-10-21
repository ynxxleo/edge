<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CopyPick extends Model
{
    protected $guarded = [];

    protected static function booted(): void
    {
        static::updating(function (self $record) {
            if ($record->isDirty(['copy_strategy_id', 'sport_event_id', 'outcome', 'odds'])) {
                throw new \LogicException('Accepted stake details and odds are immutable.');
            }
        });
    }

    protected function casts(): array
    {
        return ['odds' => 'decimal:4'];
    }

    public function event()
    {
        return $this->belongsTo(SportEvent::class, 'sport_event_id');
    }

    public function strategy()
    {
        return $this->belongsTo(CopyStrategy::class, 'copy_strategy_id');
    }

    public function stakes()
    {
        return $this->hasMany(CopyStake::class);
    }
}
