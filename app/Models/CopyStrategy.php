<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CopyStrategy extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return ['active' => 'boolean', 'stake_percentage' => 'integer'];
    }

    public function positions()
    {
        return $this->hasMany(CopyPosition::class);
    }

    public function picks()
    {
        return $this->hasMany(CopyPick::class);
    }
}
