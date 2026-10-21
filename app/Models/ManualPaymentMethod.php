<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ManualPaymentMethod extends Model
{
    protected $guarded = [];
    protected $hidden = ['image_data'];

    protected function casts(): array
    {
        return ['instructions' => 'encrypted', 'fields' => 'encrypted:array', 'image_data' => 'encrypted',
            'enabled' => 'boolean', 'deposit_enabled' => 'boolean', 'withdrawal_enabled' => 'boolean', 'version' => 'integer'];
    }
}
