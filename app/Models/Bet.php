<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Bet extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return ['stake' => 'integer', 'payout' => 'integer', 'settled_at' => 'datetime'];
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function selections()
    {
        return $this->hasMany(BetSelection::class);
    }
}
