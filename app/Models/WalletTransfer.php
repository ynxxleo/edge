<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class WalletTransfer extends Model
{
    public $timestamps = false;
    protected $guarded = [];

    protected function casts(): array
    {
        return ['sender_id' => 'integer', 'recipient_id' => 'integer', 'amount' => 'integer', 'created_at' => 'datetime'];
    }

    protected static function booted(): void
    {
        static::updating(fn () => throw new \LogicException('Completed transfers are immutable.'));
        static::deleting(fn () => throw new \LogicException('Completed transfers cannot be deleted.'));
    }

    public function sender() { return $this->belongsTo(User::class, 'sender_id'); }
    public function recipient() { return $this->belongsTo(User::class, 'recipient_id'); }

    public function publicData(User $viewer): array
    {
        abort_unless(in_array($viewer->id, [$this->sender_id, $this->recipient_id], true), 404);
        $sent = $viewer->id === $this->sender_id;
        $other = $sent ? $this->recipient : $this->sender;
        return [
            'reference' => $this->reference, 'direction' => $sent ? 'sent' : 'received',
            'amount_cents' => $this->amount, 'currency' => 'USD', 'status' => 'completed',
            'counterparty' => \App\Services\TransferService::recipientData($other),
            'created_at' => $this->created_at->toIso8601String(),
        ];
    }
}
