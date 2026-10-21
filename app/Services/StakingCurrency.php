<?php

namespace App\Services;

use App\Models\PaymentSetting;
use LogicException;

final class StakingCurrency
{
    public static function code(bool $lockForUpdate = false): string
    {
        $query = PaymentSetting::query()->whereKey(1);
        if ($lockForUpdate) {
            $query->lockForUpdate();
        }
        $currency = $query->value('wallet_currency');
        if (! in_array($currency, ['USD', 'NGN'], true)) {
            throw new LogicException('The wallet currency has not been initialized. Run the database migrations.');
        }

        return $currency;
    }
}
