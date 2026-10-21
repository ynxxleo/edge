<?php

namespace App\Services;

use App\Models\SportEvent;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

class EventService
{
    public function create(array $data, User $admin): SportEvent
    {
        StakingRules::admin($admin);
        $data = $this->validate($data);
        return StakingTransaction::run(function () use ($data, $admin) {
            $event = SportEvent::create($data + ['version' => 1]);
            StakingRules::audit($admin, 'event.created', $event);
            return $event;
        }, 5);
    }

    public function update(SportEvent $event, array $data, User $admin): SportEvent
    {
        StakingRules::admin($admin);
        return StakingTransaction::run(function () use ($event, $data, $admin) {
            $locked = SportEvent::lockForUpdate()->findOrFail($event->id);
            if (in_array($locked->status, ['finished', 'void'], true)) {
                StakingRules::fail('event', 'Settled games are immutable.');
            }
            if (isset($data['version']) && (int) $data['version'] !== $locked->version) {
                StakingRules::fail('version', 'Another administrator changed this game. Refresh before saving.');
            }
            $validated = $this->validate(array_replace($locked->only(['sport', 'league', 'country', 'home_name', 'away_name', 'starts_at', 'status', 'odds_home', 'odds_draw', 'odds_away']), $data));
            if ($locked->selections()->exists() || $locked->copyPicks()->exists()) {
                if (($validated['odds_draw'] === null) !== ($locked->odds_draw === null)) {
                    StakingRules::fail('odds_draw', 'Draw availability cannot change after a bet or copy pick has been accepted. You may update the existing odds, or void the game and create a replacement.');
                }
                foreach (['sport', 'home_name', 'away_name'] as $identity) {
                    if ($validated[$identity] !== $locked->{$identity}) {
                        StakingRules::fail($identity, 'Game participants and sport cannot change after stakes have been accepted. Void this game and create a replacement.');
                    }
                }
            }
            $before = $locked->toArray();
            $locked->fill($validated);
            $locked->version++;
            $locked->save();
            StakingRules::audit($admin, 'event.updated', $locked, $before);
            return $locked;
        }, 5);
    }

    public function void(SportEvent $event, User $admin, ?string $reason = null): SportEvent
    {
        return app(SettlementService::class)->voidEvent($event, $admin, $reason);
    }

    private function validate(array $data): array
    {
        $data = Validator::make($data, [
            'sport' => ['required', 'string', 'max:40'], 'league' => ['required', 'string', 'max:120'],
            'country' => ['nullable', 'string', 'max:80'], 'home_name' => ['required', 'string', 'max:120', 'different:away_name'],
            'away_name' => ['required', 'string', 'max:120'], 'starts_at' => ['required', 'date'],
            'status' => ['required', 'in:draft,open,live,suspended'],
            'odds_home' => ['nullable', 'numeric'], 'odds_draw' => ['nullable', 'numeric'], 'odds_away' => ['nullable', 'numeric'],
        ])->validate();
        foreach (['odds_home', 'odds_draw', 'odds_away'] as $key) {
            $data[$key] = isset($data[$key]) ? StakingRules::odds($data[$key]) : null;
        }
        if ($data['status'] === 'open' && (! $data['odds_home'] || ! $data['odds_away'])) {
            StakingRules::fail('odds', 'An open game requires valid home and away odds. Draw odds are optional.');
        }
        if ($data['status'] === 'open' && ! Carbon::parse($data['starts_at'])->isFuture()) {
            StakingRules::fail('starts_at', 'An open game must start in the future. Use live or suspended for a game already started.');
        }
        return $data;
    }
}
