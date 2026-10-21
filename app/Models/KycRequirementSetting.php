<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class KycRequirementSetting extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return ['version' => 'integer', 'layers' => 'array'];
    }
}
