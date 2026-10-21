<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class BetSelection extends Model
{
    protected $guarded = [];

    protected static function booted(): void
    {
        static::updating(function (self $record) {
            if ($record->isDirty(['bet_id', 'sport_event_id', 'outcome', 'odds'])) {
                throw new \LogicException('Accepted stake details and odds are immutable.');
            }
        });
    }

    protected function casts(): array
    {
        return ['odds' => 'decimal:4'];
    }

    public function bet()
    {
        return $this->belongsTo(Bet::class);
    }

    public function event()
    {
        return $this->belongsTo(SportEvent::class, 'sport_event_id');
    }
}
