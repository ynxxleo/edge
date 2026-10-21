<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;

final class StakingTransaction
{
    public static function run(callable $callback, int $attempts = 5): mixed
    {
        return DB::transaction(function () use ($callback) {
            if (DB::connection()->getDriverName() === 'sqlite' && DB::transactionLevel() === 1) {
                // SQLite ignores row-level FOR UPDATE. Laravel also uses DEFERRED transactions
                // on PHP 8.3, regardless of transaction_mode. Acquire its writer reservation
                // before reading balances or results, so concurrent requests read committed state.
                DB::table('staking_mutexes')->where('id', 1)->update(['token' => 0]);
            }
            return $callback();
        }, $attempts);
    }
}
