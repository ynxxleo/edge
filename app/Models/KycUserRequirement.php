<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class KycUserRequirement extends Model
{
    protected $guarded = [];

    protected $hidden = ['reason', 'layers'];

    protected function casts(): array
    {
        return ['version' => 'integer', 'layer_ids' => 'array', 'reason' => 'encrypted', 'layers' => 'encrypted:array'];
    }
}
