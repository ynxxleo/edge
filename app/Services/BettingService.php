<?php

namespace App\Services;

use App\Models\Bet;
use App\Models\SportEvent;
use App\Models\User;
use Illuminate\Support\Facades\DB;

class BettingService
{
    public function __construct(private WalletService $wallet) {}

    public function place(User $user, array $selections, int $stake, string $type, string $idempotencyKey): Bet
    {
        StakingRules::amount($stake, 'stake');
        if (($type === 'single' && count($selections) !== 1) || ($type === 'multiple' && (count($selections) < 2 || count($selections) > 20)) || ! in_array($type, ['single', 'multiple'], true)) {
            StakingRules::fail('selections', 'Singles require one selection; multiples require between two and twenty different events.');
        }
        $normalized = [];
        foreach ($selections as $selection) {
            if (! isset($selection['event_id'], $selection['outcome'], $selection['expected_odds']) || ! is_numeric($selection['event_id'])) {
                StakingRules::fail('selections', 'Each selection needs an event, outcome and reviewed odds.');
            }
            $normalized[] = ['event_id' => (int) $selection['event_id'], 'outcome' => (string) $selection['outcome'], 'expected_odds' => StakingRules::odds($selection['expected_odds']), 'expected_version' => isset($selection['expected_version']) ? (int) $selection['expected_version'] : null];
        }
        usort($normalized, fn ($a, $b) => $a['event_id'] <=> $b['event_id']);
        if (count(array_unique(array_column($normalized, 'event_id'))) !== count($normalized)) {
            StakingRules::fail('selections', 'Only one outcome per game may appear in a bet.');
        }
        $reference = StakingRules::reference('bet', $user, $idempotencyKey);
        $hash = hash('sha256', json_encode([$normalized, $stake, $type]));
        return StakingTransaction::run(function () use ($user, $normalized, $stake, $type, $reference, $hash) {
            // Event rows are locked in a stable order so odds updates and settlement cannot race placement.
            $events = SportEvent::whereIn('id', array_column($normalized, 'event_id'))->orderBy('id')->lockForUpdate()->get()->keyBy('id');
            User::lockForUpdate()->findOrFail($user->id);
            $existing = Bet::where('reference', $reference)->first();
            if ($existing) {
                if (! hash_equals($existing->request_hash, $hash)) {
                    StakingRules::fail('idempotency_key', 'This request key has already been used for a different bet.');
                }
                return $existing->load('selections.event');
            }
            $accepted = [];
            foreach ($normalized as $selection) {
                $event = $events->get($selection['event_id']);
                if (! $event) {
                    StakingRules::fail('selections', 'A selected game no longer exists.');
                }
                $odds = StakingRules::market($event, $selection['outcome']);
                if (bccomp($odds, $selection['expected_odds'], 4) !== 0 || ($selection['expected_version'] !== null && $event->version !== $selection['expected_version'])) {
                    StakingRules::fail('selections', 'Odds or game details have changed. Refresh and review your bet slip.');
                }
                $accepted[] = ['sport_event_id' => $event->id, 'outcome' => $selection['outcome'], 'odds' => $odds, 'status' => 'pending'];
            }
            StakingRules::payout($stake, array_column($accepted, 'odds'));
            $bet = Bet::create(['user_id' => $user->id, 'reference' => $reference, 'request_hash' => $hash, 'type' => $type, 'stake' => $stake, 'status' => 'pending', 'payout' => 0]);
            $bet->selections()->createMany($accepted);
            $this->wallet->debit($user, $stake, 'stake', 'stake-'.$bet->reference, ['bet_id' => $bet->id]);
            return $bet->load('selections.event');
        }, 5);
    }
}
