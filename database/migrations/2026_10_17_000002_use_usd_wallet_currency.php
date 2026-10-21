<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Old wallet tables have no per-row currency. Never silently relabel
        // their monetary history merely because the application's default changed.
        $hasLegacyFunds = $this->hasFinancialRecords();
        Schema::table('payment_settings', function (Blueprint $table): void {
            $table->string('wallet_currency', 3)->default('USD');
        });
        DB::table('payment_settings')->where('id', 1)->update([
            'wallet_currency' => $hasLegacyFunds ? 'NGN' : config('staking.currency', 'USD'),
        ]);
        Schema::table('stripe_payments', function (Blueprint $table): void {
            $table->string('currency', 3)->default('USD')->change();
        });
    }

    public function down(): void
    {
        if (DB::table('payment_settings')->where('wallet_currency', 'USD')->exists() && $this->hasFinancialRecords()) {
            throw new RuntimeException('Cannot remove USD wallet currency metadata while financial records exist. Preserve the current database and reconcile its currency first.');
        }
        Schema::table('stripe_payments', function (Blueprint $table): void {
            $table->string('currency', 3)->default('NGN')->change();
        });
        Schema::table('payment_settings', fn (Blueprint $table) => $table->dropColumn('wallet_currency'));
    }

    private function hasFinancialRecords(): bool
    {
        if (DB::table('users')->where('wallet_balance', '!=', 0)->exists()) {
            return true;
        }
        foreach (['wallet_transactions', 'wallet_requests', 'bets', 'copy_positions', 'copy_stakes'] as $table) {
            if (DB::table($table)->exists()) {
                return true;
            }
        }

        return false;
    }
};
