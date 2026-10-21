<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PaymentSetting extends Model
{
    protected $guarded = [];

    protected $hidden = ['stripe_secret_key', 'stripe_webhook_secret', 'previous_webhook_secrets'];

    protected function casts(): array
    {
        return [
            'version' => 'integer', 'stripe_enabled' => 'boolean', 'manual_enabled' => 'boolean',
            'stripe_secret_key' => 'encrypted', 'stripe_webhook_secret' => 'encrypted',
            'previous_webhook_secrets' => 'encrypted:array',
            'manual_bank_name' => 'encrypted', 'manual_account_name' => 'encrypted',
            'manual_account_number' => 'encrypted', 'manual_instructions' => 'encrypted',
            'manual_reference_label' => 'encrypted', 'manual_support_contact' => 'encrypted',
        ];
    }
}
