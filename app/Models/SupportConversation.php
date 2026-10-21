<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SupportConversation extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return ['version' => 'integer', 'bot_answers' => 'integer', 'last_message_at' => 'datetime', 'resolved_at' => 'datetime'];
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function assignedAdmin()
    {
        return $this->belongsTo(User::class, 'assigned_admin_id');
    }

    public function messages()
    {
        return $this->hasMany(SupportMessage::class);
    }
}
