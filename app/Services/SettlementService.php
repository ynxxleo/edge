<?php

namespace App\Services;

use App\Models\Bet;
use App\Models\BetSelection;
use App\Models\CopyPick;
use App\Models\CopyPosition;
use App\Models\CopyStake;
use App\Models\SportEvent;
use App\Models\User;
use Illuminate\Support\Facades\DB;

class SettlementService
{
    public function __construct(private WalletService $wallet) {}

    public function settleEvent(SportEvent $event, int $home, int $away, User $admin): SportEvent
    {
        StakingRules::admin($admin);
        if ($home < 0 || $away < 0 || $home > 10000 || $away > 10000) {
            StakingRules::fail('score', 'Final scores must be integers between zero and 10,000.');
        }
        return $this->finish($event, $admin, $home, $away);
    }

    public function voidEvent(SportEvent $event, User $admin, ?string $reason = null): SportEvent
    {
        StakingRules::admin($admin);
        return $this->finish($event, $admin, null, null, $reason);
    }

    private function finish(SportEvent $event, User $admin, ?int $home, ?int $away, ?string $reason = null): SportEvent
    {
        return StakingTransaction::run(function () use ($event, $admin, $home, $away, $reason) {
            $event = SportEvent::lockForUpdate()->findOrFail($event->id);
            $void = $home === null;
            $target = $void ? 'void' : 'finished';
            if (in_array($event->status, ['finished', 'void'], true)) {
                if ($event->status === $target && $event->home_score === $home && $event->away_score === $away) {
                    return $event;
                }
                StakingRules::fail('score', 'This game has already settled. Final results cannot be overwritten.');
            }
            if (! $void && $event->starts_at->isFuture()) {
                StakingRules::fail('score', 'A game cannot be settled before its scheduled start.');
            }
            if (! $void && $home === $away && $event->odds_draw === null && ! $event->selections()->where('outcome', 'draw')->exists() && ! $event->copyPicks()->where('outcome', 'draw')->exists()) {
                StakingRules::fail('score', 'This two-outcome market needs a final score including any overtime, or must be voided.');
            }
            $before = $event->toArray();
            $winner = $void ? null : ($home > $away ? 'home' : ($home < $away ? 'away' : 'draw'));
            $event->fill(['status' => $target, 'home_score' => $home, 'away_score' => $away, 'settled_at' => now(), 'version' => $event->version + 1])->save();
            $selections = BetSelection::where('sport_event_id', $event->id)->orderBy('id')->lockForUpdate()->get();
            foreach ($selections as $selection) {
                $selection->status = $void ? 'void' : ($selection->outcome === $winner ? 'won' : 'lost');
                $selection->save();
            }
            foreach ($selections->pluck('bet_id')->unique()->sort()->values() as $betId) {
                $this->settleBet((int) $betId);
            }
            $pickIds = CopyPick::where('sport_event_id', $event->id)->pluck('id');
            $stakes = CopyStake::whereIn('copy_pick_id', $pickIds)->where('status', 'pending')->with('pick')->orderBy('copy_position_id')->lockForUpdate()->get();
            foreach ($stakes as $stake) {
                $position = CopyPosition::lockForUpdate()->findOrFail($stake->copy_position_id);
                $status = $void ? 'void' : ($stake->pick->outcome === $winner ? 'won' : 'lost');
                $payout = $void ? $stake->stake : ($status === 'won' ? StakingRules::payout($stake->stake, [$stake->odds]) : 0);
                $stake->fill(['status' => $status, 'payout' => $payout, 'settled_at' => now()])->save();
                $position->value += $payout;
                $position->profit += $payout - $stake->stake;
                $position->save();
            }
            StakingRules::audit($admin, $void ? 'event.voided' : 'event.settled', $event, $before, $reason);
            return $event;
        }, 5);
    }

    private function settleBet(int $betId): void
    {
        $bet = Bet::lockForUpdate()->findOrFail($betId);
        if ($bet->status !== 'pending') {
            return;
        }
        $legs = $bet->selections()->get();
        if ($legs->contains('status', 'lost')) {
            $status = 'lost';
            $payout = 0;
        } elseif ($legs->contains('status', 'pending')) {
            return;
        } elseif ($legs->every(fn ($leg) => $leg->status === 'void')) {
            $status = 'void';
            $payout = $bet->stake;
        } else {
            $status = 'won';
            $payout = StakingRules::payout($bet->stake, $legs->map(fn ($leg) => $leg->status === 'void' ? '1.0000' : $leg->odds));
        }
        $bet->fill(['status' => $status, 'payout' => $payout, 'settled_at' => now()])->save();
        if ($payout > 0) {
            $this->wallet->credit($bet->user, $payout, $status === 'void' ? 'refund' : 'payout', 'settlement-'.$bet->reference, ['bet_id' => $bet->id]);
        }
    }
}
