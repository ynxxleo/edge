<?php

namespace App\Console\Commands;

use App\Models\AdminAudit;
use App\Models\PaymentSetting;
use App\Models\StripePayment;
use App\Models\User;
use App\Services\StakingTransaction;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use RuntimeException;

class UseUsdWalletCurrency extends Command
{
    protected $signature = 'edge:currency-usd
        {--keep-amounts : Confirm that local test funds keep the same numeric amounts}
        {--admin= : Existing administrator email to record in the audit log}';

    protected $description = 'Explicitly redenominate local test wallets from NGN to USD without changing monetary integers';

    public function handle(): int
    {
        if (! app()->environment('local', 'testing')) {
            $this->error('This command is limited to local or testing environments. Production funds require a separately reviewed currency migration.');

            return self::FAILURE;
        }
        if (! $this->option('keep-amounts')) {
            $this->error('Pass --keep-amounts only after approving that these are test funds and all numeric amounts must stay unchanged. No exchange rate is applied.');

            return self::FAILURE;
        }
        $admin = User::where('email', strtolower(trim((string) $this->option('admin'))))->where('is_admin', true)->first();
        if (! $admin) {
            $this->error('Supply an existing administrator email using --admin.');

            return self::FAILURE;
        }

        try {
            $changed = StakingTransaction::run(function () use ($admin): bool {
                $settings = PaymentSetting::lockForUpdate()->findOrFail(1);
                if ($settings->wallet_currency === 'USD') {
                    return false;
                }
                if ($settings->wallet_currency !== 'NGN') {
                    throw new RuntimeException('The current wallet currency is not NGN. No change was made.');
                }
                if (StripePayment::where('mode', 'live')->exists()) {
                    throw new RuntimeException('Live Stripe payment history exists. This local test-funds command cannot change its wallet denomination.');
                }
                $counts = [];
                foreach (['wallet_transactions', 'wallet_requests', 'bets', 'copy_positions', 'copy_stakes', 'stripe_payments'] as $table) {
                    $counts[$table] = DB::table($table)->count();
                }
                $settings->wallet_currency = 'USD';
                $settings->version++;
                $settings->save();
                AdminAudit::create([
                    'actor_id' => $admin->id, 'action' => 'wallet.currency_changed',
                    'subject_type' => 'PaymentSetting', 'subject_id' => $settings->id,
                    'reason' => 'Approved local test funds retain the same numeric amounts. No foreign exchange conversion was applied.',
                    'before' => ['currency' => 'NGN', 'record_counts' => $counts],
                    'after' => ['currency' => 'USD', 'monetary_values_unchanged' => true, 'stripe_history_currencies_unchanged' => true],
                ]);

                return true;
            });
        } catch (RuntimeException $exception) {
            $this->error($exception->getMessage());

            return self::FAILURE;
        }

        $this->info($changed ? 'Wallet currency is now USD. All monetary integers and historical Stripe currencies are unchanged; the change was audited.' : 'Wallet currency is already USD. No change was made.');

        return self::SUCCESS;
    }
}
