<?php

namespace App\Http\Controllers;

use App\Models\Bet;
use App\Models\CopyPick;
use App\Models\CopyPosition;
use App\Models\CopyStrategy;
use App\Models\SportEvent;
use App\Models\WalletRequest;
use App\Services\StakingRules;

/** Explicit response objects keep account internals and request hashes private. */
class StakingData
{
    public static function user($user): ?array
    {
        if (! $user) {
            return null;
        }
        $kyc = app(\App\Services\KycService::class)->summary($user);

        return [
            'id' => $user->id, 'name' => $user->name, 'email' => $user->email, 'is_admin' => (bool) $user->is_admin,
            'kyc_status' => $kyc['status'],
            'kyc' => ['status' => $kyc['status'], 'withdrawal_requires_approval' => $kyc['withdrawal_requires_approval']],
        ];
    }

    public static function event(SportEvent $event): array
    {
        $code = fn ($name) => mb_strtoupper(mb_substr(preg_replace('/[^\pL\pN]/u', '', $name), 0, 3));

        return [
            'id' => $event->id, 'sport' => $event->sport, 'league' => $event->league,
            'country' => $event->country, 'home_name' => $event->home_name, 'away_name' => $event->away_name,
            'home_code' => $code($event->home_name), 'away_code' => $code($event->away_name),
            'starts_at' => $event->starts_at?->toIso8601String(), 'status' => $event->status,
            'odds_home' => $event->odds_home, 'odds_draw' => $event->odds_draw, 'odds_away' => $event->odds_away,
            'home_score' => $event->home_score, 'away_score' => $event->away_score,
            'version' => $event->version, 'settled_at' => $event->settled_at?->toIso8601String(),
        ];
    }

    public static function bet(Bet $bet): array
    {
        $bet->loadMissing('selections.event');
        $odds = [];
        foreach ($bet->selections as $selection) {
            $odds[] = match ($selection->status) {
                'lost' => '0',
                'void' => '1',
                default => $selection->odds,
            };
        }
        $potential = $bet->status === 'pending' ? StakingRules::payout($bet->stake, $odds) : $bet->payout;

        return [
            'id' => $bet->id, 'reference' => $bet->reference, 'type' => $bet->type,
            'stake_cents' => $bet->stake, 'payout_cents' => $bet->payout,
            'potential_return_cents' => $potential, 'status' => $bet->status,
            'date' => $bet->created_at?->toIso8601String(), 'created_at' => $bet->created_at?->toIso8601String(),
            'settled_at' => $bet->settled_at?->toIso8601String(),
            'selections' => $bet->selections->map(fn ($selection) => [
                'id' => $selection->id, 'event_id' => $selection->sport_event_id,
                'home_name' => $selection->event->home_name, 'away_name' => $selection->event->away_name,
                'outcome' => $selection->outcome, 'odds' => $selection->odds, 'status' => $selection->status,
                'event' => self::event($selection->event),
            ])->all(),
        ];
    }

    public static function strategy(CopyStrategy $strategy): array
    {
        return [
            'id' => $strategy->id, 'slug' => $strategy->slug, 'name' => $strategy->name,
            'sport' => $strategy->sport, 'description' => $strategy->description,
            'risk' => $strategy->risk, 'risk_level' => $strategy->risk,
            'stake_percentage' => $strategy->stake_percentage, 'allocation_percent' => $strategy->stake_percentage,
            'active' => $strategy->active, 'status' => $strategy->active ? 'active' : 'inactive',
            'min_deposit_cents' => 10000,
        ];
    }

    public static function position(CopyPosition $position): array
    {
        $position->loadMissing('strategy', 'stakes.pick.event');
        $reserved = (int) $position->stakes->where('status', 'pending')->sum('stake');

        return [
            'id' => $position->id, 'strategy_id' => $position->copy_strategy_id,
            'strategy' => self::strategy($position->strategy), 'principal_cents' => $position->principal,
            'value_cents' => $position->value, 'reserved_cents' => $reserved,
            'pending_stakes_count' => $position->stakes->where('status', 'pending')->count(),
            'equity_cents' => $position->value + $reserved, 'profit_cents' => $position->profit,
            'status' => $position->status, 'stake_percentage' => $position->strategy->stake_percentage,
            'created_at' => $position->created_at?->toIso8601String(),
            'performance' => self::positionPerformance($position),
            'stakes' => $position->stakes->map(fn ($stake) => [
                'id' => $stake->id, 'event_id' => $stake->pick->sport_event_id,
                'outcome' => $stake->pick->outcome, 'odds' => $stake->odds,
                'stake_cents' => $stake->stake, 'payout_cents' => $stake->payout,
                'status' => $stake->status, 'event' => self::event($stake->pick->event),
                'created_at' => $stake->created_at?->toIso8601String(),
                'settled_at' => $stake->settled_at?->toIso8601String(),
            ])->all(),
        ];
    }

    /** Keep the capital curve independent of reservations and returns to the wallet. */
    private static function positionPerformance(CopyPosition $position): array
    {
        $resolved = fn ($stake) => in_array($stake->status, ['won', 'lost', 'void'], true);
        $recordedAt = fn ($stake) => $resolved($stake)
            ? ($stake->settled_at ?? $stake->pick->event->settled_at ?? $stake->updated_at ?? $stake->created_at)
            : $stake->created_at;
        $change = fn ($stake) => match ($stake->status) {
            // Use the stored, rounded payout accepted by settlement, never floating-point odds.
            'won' => $stake->payout - $stake->stake,
            'lost' => -$stake->stake,
            'void' => 0,
            default => null,
        };
        $chronology = fn ($left, $right) =>
            (($recordedAt($left)?->getTimestamp() ?? 0) <=> ($recordedAt($right)?->getTimestamp() ?? 0))
            ?: ($left->id <=> $right->id);
        $settled = $position->stakes->filter($resolved)->sort($chronology)->values();
        $capital = $position->principal;
        $points = [[
            'id' => 'deposit', 'type' => 'deposit',
            'recorded_at' => $position->created_at?->toIso8601String(),
            'value_cents' => $capital, 'change_cents' => $capital,
            'label' => 'Initial deposit', 'stake_id' => null, 'status' => 'deposit',
        ]];
        foreach ($settled as $stake) {
            $movement = $change($stake);
            $capital += $movement;
            $points[] = [
                'id' => 'stake-'.$stake->id, 'type' => 'settlement',
                'recorded_at' => $recordedAt($stake)?->toIso8601String(),
                'value_cents' => $capital, 'change_cents' => $movement,
                'label' => $stake->pick->event->home_name.' vs '.$stake->pick->event->away_name,
                'stake_id' => $stake->id, 'status' => $stake->status,
            ];
        }

        return [
            'initial_deposit_cents' => $position->principal,
            'current_value_cents' => $capital,
            'net_profit_cents' => $capital - $position->principal,
            'return_percentage' => $position->principal > 0 ? round(($capital - $position->principal) / $position->principal * 100, 2) : 0,
            'settled_stakes_count' => $settled->count(),
            'points' => $points,
            'games' => $position->stakes->sort(fn ($left, $right) => $chronology($right, $left))->values()->map(fn ($stake) => [
                'id' => $stake->id, 'event_id' => $stake->pick->sport_event_id,
                'home_name' => $stake->pick->event->home_name, 'away_name' => $stake->pick->event->away_name,
                'outcome' => $stake->pick->outcome, 'odds' => $stake->odds,
                'status' => $stake->status, 'stake_cents' => $stake->stake,
                'payout_cents' => $stake->payout, 'net_change_cents' => $change($stake),
                'created_at' => $stake->created_at?->toIso8601String(),
                'settled_at' => $resolved($stake) ? $recordedAt($stake)?->toIso8601String() : null,
            ])->all(),
        ];
    }

    public static function walletRequest(WalletRequest $request, bool $includeUser = false): array
    {
        $data = [
            'id' => $request->id, 'reference' => $request->reference, 'type' => $request->type,
            'amount_cents' => $request->amount, 'status' => $request->status,
            'method' => $request->method, 'method_name' => $request->manual_details['manual_payment_method']['name'] ?? $request->method,
            'details' => $request->manual_details ?? $request->details,
            'admin_reference' => $request->admin_reference,
            'review_note' => $request->review_note,
            'reviewed_at' => $request->reviewed_at?->toIso8601String(),
            'created_at' => $request->created_at?->toIso8601String(),
        ];
        if ($includeUser) {
            $data['user'] = self::user($request->user);
        }

        return $data;
    }

    public static function pick(CopyPick $pick): array
    {
        $pick->loadMissing('strategy', 'event');

        return [
            'id' => $pick->id, 'strategy_id' => $pick->copy_strategy_id,
            'event_id' => $pick->sport_event_id, 'outcome' => $pick->outcome, 'odds' => $pick->odds,
            'strategy' => self::strategy($pick->strategy), 'event' => self::event($pick->event),
            'status' => $pick->event->status, 'created_at' => $pick->created_at?->toIso8601String(),
        ];
    }
}
