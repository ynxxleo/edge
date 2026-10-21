<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CopyPosition extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return ['principal' => 'integer', 'value' => 'integer', 'profit' => 'integer'];
    }

    public function user()
    {
        return $this->belongsTo(User::class);
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
