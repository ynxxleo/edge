<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class WalletRequest extends Model
{
    protected $guarded = [];

    protected $hidden = ['manual_details'];

    protected function casts(): array
    {
        return ['amount' => 'integer', 'details' => 'array', 'manual_details' => 'encrypted:array', 'reviewed_at' => 'datetime'];
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function reviewer()
    {
        return $this->belongsTo(User::class, 'reviewed_by');
    }
}
