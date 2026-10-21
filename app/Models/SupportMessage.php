<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use LogicException;

class SupportMessage extends Model
{
    protected $guarded = [];

    protected $hidden = ['body', 'idempotency_hash'];

    protected function casts(): array
    {
        return ['body' => 'encrypted'];
    }

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('Support history cannot be edited.'));
        static::deleting(fn () => throw new LogicException('Support history cannot be deleted.'));
    }

    public function conversation()
    {
        return $this->belongsTo(SupportConversation::class, 'support_conversation_id');
    }

    public function sender()
    {
        return $this->belongsTo(User::class, 'sender_id');
    }
}
