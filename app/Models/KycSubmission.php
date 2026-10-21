<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class KycSubmission extends Model
{
    protected $guarded = [];

    protected $hidden = [
        'legal_name', 'date_of_birth', 'country', 'address', 'document_type',
        'document_number', 'documents', 'review_note', 'requirements_snapshot', 'answers',
    ];

    protected function casts(): array
    {
        return [
            'version' => 'integer',
            'requirements_version' => 'integer',
            'requirements_snapshot' => 'encrypted:array', 'answers' => 'encrypted:array',
            'legal_name' => 'encrypted', 'date_of_birth' => 'encrypted',
            'country' => 'encrypted', 'address' => 'encrypted',
            'document_type' => 'encrypted', 'document_number' => 'encrypted',
            'documents' => 'encrypted:array', 'review_note' => 'encrypted',
            'consented_at' => 'datetime', 'reviewed_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::updating(function (self $submission): void {
            if ($submission->getRawOriginal('status') !== 'pending') {
                throw new \LogicException('Reviewed verification submissions are immutable.');
            }
            $allowed = ['status', 'version', 'review_note', 'reviewed_by', 'reviewed_at', 'updated_at'];
            if (array_diff(array_keys($submission->getDirty()), $allowed)) {
                throw new \LogicException('Submitted identity data cannot be changed.');
            }
            if (! in_array($submission->status, ['approved', 'rejected'], true)) {
                throw new \LogicException('A verification submission may only receive a final review.');
            }
        });
        static::deleting(fn () => throw new \LogicException('Verification review history cannot be deleted.'));
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
