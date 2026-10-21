<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SportEvent extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return ['starts_at' => 'datetime', 'settled_at' => 'datetime', 'odds_home' => 'decimal:4', 'odds_draw' => 'decimal:4', 'odds_away' => 'decimal:4', 'home_score' => 'integer', 'away_score' => 'integer', 'version' => 'integer'];
    }

    public function selections()
    {
        return $this->hasMany(BetSelection::class);
    }

    public function copyPicks()
    {
        return $this->hasMany(CopyPick::class);
    }
}
