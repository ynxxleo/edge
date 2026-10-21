<?php

namespace App\Console\Commands;

use App\Models\PaymentSetting;
use App\Models\StripePayment;
use App\Services\StakingTransaction;
use Illuminate\Console\Command;

class PrunePaymentSecrets extends Command
{
    protected $signature = 'edge:payments-prune-secrets';

    protected $description = 'Remove expired payment credential snapshots without changing payments or wallet records';

    public function handle(): int
    {
        $removed = StakingTransaction::run(function (): int {
            $removed = StripePayment::whereNotNull('pending_secret_key')->where('created_at', '<=', now()->subHours(23))
                ->update(['pending_secret_key' => null, 'pending_payload' => null]);
            $settings = PaymentSetting::lockForUpdate()->findOrFail(1);
            $previous = $settings->previous_webhook_secrets ?? [];
            $valid = array_values(array_filter($previous, fn ($entry) => ($entry['expires_at'] ?? 0) >= now()->timestamp));
            if (count($valid) !== count($previous)) {
                $settings->previous_webhook_secrets = $valid;
                $settings->save();
            }
            return $removed + count($previous) - count($valid);
        });
        $this->info('Removed '.$removed.' expired payment credential snapshots. Payment and wallet records were preserved.');
        return self::SUCCESS;
    }
}
