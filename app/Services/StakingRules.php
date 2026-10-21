<?php

namespace App\Services;

use App\Models\AdminAudit;
use App\Models\SportEvent;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Validation\ValidationException;

final class StakingRules
{
    public const MAX_AMOUNT = 100_000_000; // Maximum minor units per instruction.
    public const MAX_PAYOUT = 100_000_000_000;

    public static function fail(string $field, string $message): never
    {
        throw ValidationException::withMessages([$field => $message]);
    }

    public static function admin(User $user): void
    {
        abort_unless($user->is_admin, 403, 'Administrator access is required.');
    }

    public static function amount(int $amount, string $field = 'amount'): void
    {
        if ($amount < 100 || $amount > self::MAX_AMOUNT) {
            self::fail($field, 'Enter an amount between 100 and 100,000,000 minor units.');
        }
    }

    public static function reference(string $prefix, User $user, string $key): string
    {
        if (strlen($key) < 8 || strlen($key) > 120) {
            self::fail('idempotency_key', 'Provide a request key between 8 and 120 characters.');
        }
        return $prefix.'-'.$user->id.'-'.substr(hash('sha256', $key), 0, 40);
    }

    public static function odds(mixed $value): string
    {
        if (! is_numeric($value) || ! preg_match('/^\d+(\.\d{1,4})?$/D', (string) $value) || bccomp((string) $value, '1.0000', 4) <= 0 || bccomp((string) $value, '1000.0000', 4) > 0) {
            self::fail('odds', 'Decimal odds must be greater than 1, at most 1000, and have at most four decimal places.');
        }
        return bcadd((string) $value, '0', 4);
    }

    /** Exact decimal multiplication, followed by a single rounding down to minor units. */
    public static function payout(int $stake, iterable $odds): int
    {
        $result = (string) $stake;
        $scale = 0;
        foreach ($odds as $odd) {
            $scale += 4;
            $result = bcmul($result, (string) $odd, $scale);
            if (bccomp($result, (string) self::MAX_PAYOUT, $scale) > 0) {
                self::fail('stake', 'Potential payout exceeds the payout limit. Reduce your stake or selections.');
            }
        }
        return (int) bcdiv($result, '1', 0);
    }

    public static function market(SportEvent $event, string $outcome): string
    {
        if (! in_array($outcome, ['home', 'draw', 'away'], true)) {
            self::fail('outcome', 'Select home, draw or away.');
        }
        if ($event->status !== 'open' || ! $event->starts_at->isFuture()) {
            self::fail('selections', 'This event is closed for staking. Refresh the available games.');
        }
        $odds = $event->{'odds_'.$outcome};
        if ($odds === null) {
            self::fail('outcome', 'That outcome is unavailable.');
        }
        return self::odds($odds);
    }

    public static function audit(User $actor, string $action, Model $subject, ?array $before = null, ?string $reason = null): void
    {
        AdminAudit::create([
            'actor_id' => $actor->id,
            'action' => $action,
            'reason' => $reason,
            'subject_type' => class_basename($subject),
            'subject_id' => $subject->id,
            'before' => $before,
            'after' => $subject->fresh()->toArray(),
        ]);
    }
}
