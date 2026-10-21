<?php

namespace App\Services;

use App\Models\CopyPick;
use App\Models\CopyPosition;
use App\Models\CopyStrategy;
use App\Models\SportEvent;
use App\Models\User;
use Illuminate\Support\Facades\DB;

class CopyService
{
    public function __construct(private WalletService $wallet) {}

    public function fund(User $user, CopyStrategy $strategy, int $amount, string $idempotencyKey): CopyPosition
    {
        StakingRules::amount($amount);
        if ($amount < 10000) {
            StakingRules::fail('amount', 'The minimum copy staking allocation is 10,000 minor units.');
        }
        $reference = StakingRules::reference('copy', $user, $idempotencyKey);
        return StakingTransaction::run(function () use ($user, $strategy, $amount, $reference) {
            $strategy = CopyStrategy::lockForUpdate()->findOrFail($strategy->id);
            User::lockForUpdate()->findOrFail($user->id);
            $existing = CopyPosition::where('funding_reference', $reference)->first();
            if ($existing) {
                if ($existing->user_id !== $user->id || $existing->copy_strategy_id !== $strategy->id || $existing->principal !== $amount) {
                    StakingRules::fail('idempotency_key', 'This funding key has already been used for different details.');
                }
                return $existing->load('strategy');
            }
            if (! $strategy->active) {
                StakingRules::fail('strategy', 'This strategy is not accepting funding.');
            }
            $position = CopyPosition::create(['user_id' => $user->id, 'copy_strategy_id' => $strategy->id, 'funding_reference' => $reference, 'principal' => $amount, 'value' => $amount, 'profit' => 0, 'status' => 'active']);
            $this->wallet->debit($user, $amount, 'copy_allocation', 'allocation-'.$reference, ['copy_position_id' => $position->id]);
            return $position->load('strategy');
        }, 5);
    }

    public function changeStatus(CopyPosition $position, string $status): CopyPosition
    {
        if (! in_array($status, ['active', 'paused'], true)) {
            StakingRules::fail('status', 'Choose active or paused.');
        }
        return StakingTransaction::run(function () use ($position, $status) {
            $position = CopyPosition::lockForUpdate()->findOrFail($position->id);
            if ($position->status === 'closed') {
                StakingRules::fail('status', 'A closed position cannot be resumed. Fund a new position.');
            }
            $position->status = $status;
            $position->save();
            return $position->load('strategy');
        }, 5);
    }

    public function close(CopyPosition $position): CopyPosition
    {
        return StakingTransaction::run(function () use ($position) {
            $position = CopyPosition::lockForUpdate()->findOrFail($position->id);
            if ($position->status === 'closed') {
                return $position->load('strategy');
            }
            if ($position->stakes()->where('status', 'pending')->exists()) {
                StakingRules::fail('position', 'This position has unsettled stakes. Pause copying and wait for their results before returning funds.');
            }
            if ($position->value > 0) {
                $this->wallet->credit($position->user, $position->value, 'copy_return', 'return-'.$position->funding_reference, ['copy_position_id' => $position->id]);
            }
            $position->value = 0;
            $position->status = 'closed';
            $position->save();
            return $position->load('strategy');
        }, 5);
    }

    public function publishPick(CopyStrategy $strategy, SportEvent $event, string $outcome, User $admin): CopyPick
    {
        StakingRules::admin($admin);
        return StakingTransaction::run(function () use ($strategy, $event, $outcome, $admin) {
            $event = SportEvent::lockForUpdate()->findOrFail($event->id);
            $strategy = CopyStrategy::lockForUpdate()->findOrFail($strategy->id);
            $existing = CopyPick::where('copy_strategy_id', $strategy->id)->where('sport_event_id', $event->id)->first();
            if ($existing) {
                if ($existing->outcome !== $outcome) {
                    StakingRules::fail('outcome', 'This strategy has already published a different outcome for this game.');
                }
                return $existing->load('event', 'strategy', 'stakes');
            }
            if (! $strategy->active || $strategy->stake_percentage < 1 || $strategy->stake_percentage > 100) {
                StakingRules::fail('strategy', 'Activate the strategy with a stake allocation between 1 and 100 percent.');
            }
            if ($strategy->sport !== 'all' && strcasecmp($strategy->sport, $event->sport) !== 0) {
                StakingRules::fail('event', 'This game does not match the strategy sport.');
            }
            $odds = StakingRules::market($event, $outcome);
            $pick = CopyPick::create(['copy_strategy_id' => $strategy->id, 'sport_event_id' => $event->id, 'outcome' => $outcome, 'odds' => $odds, 'published_by' => $admin->id]);
            // Copy only positions funded before publication; paused positions receive no new stakes.
            $positions = CopyPosition::where('copy_strategy_id', $strategy->id)->where('status', 'active')->orderBy('id')->lockForUpdate()->get();
            foreach ($positions as $position) {
                $stake = min(StakingRules::MAX_AMOUNT, intdiv($position->value * $strategy->stake_percentage, 100));
                if ($stake < 100) {
                    continue;
                }
                StakingRules::payout($stake, [$odds]);
                $position->stakes()->create(['copy_pick_id' => $pick->id, 'stake' => $stake, 'odds' => $odds, 'status' => 'pending', 'payout' => 0]);
                $position->value -= $stake;
                $position->save();
            }
            StakingRules::audit($admin, 'copy.pick_published', $pick);
            return $pick->load('event', 'strategy', 'stakes');
        }, 5);
    }
}
