<?php

namespace App\Http\Controllers;

use App\Models\AdminAudit;
use App\Models\Bet;
use App\Models\CopyPick;
use App\Models\CopyStrategy;
use App\Models\SportEvent;
use App\Models\User;
use App\Models\WalletRequest;
use App\Services\CopyService;
use App\Services\EventService;
use App\Services\SettlementService;
use App\Services\WalletRequestService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class AdminController extends ApiController
{
    public function overview(): JsonResponse
    {
        return response()->json([
            'counts' => [
                'events' => SportEvent::count(), 'open_events' => SportEvent::where('status', 'open')->count(),
                'users' => User::count(), 'pending_requests' => WalletRequest::where('status', 'pending')->count(),
                'open_bets' => Bet::where('status', 'pending')->count(),
            ],
            'pending_requests' => WalletRequest::with('user')->where('status', 'pending')->oldest()->limit(50)->get()
                ->map(fn ($item) => StakingData::walletRequest($item, true)),
            'recent_audits' => AdminAudit::with('actor')->latest()->limit(50)->get()->map(fn ($audit) => [
                'id' => $audit->id, 'action' => $audit->action,
                'subject_type' => $audit->subject_type, 'subject_id' => $audit->subject_id,
                'actor' => StakingData::user($audit->actor), 'before' => $audit->before, 'after' => $audit->after,
                'reason' => $audit->reason,
                'created_at' => $audit->created_at?->toIso8601String(),
            ]),
        ])->header('Cache-Control', 'no-store');
    }

    public function events(): JsonResponse
    {
        return response()->json(['events' => SportEvent::orderByDesc('starts_at')->get()->map(StakingData::event(...))]);
    }

    private function eventRules(bool $updating = false): array
    {
        $presence = $updating ? 'sometimes' : 'required';
        $rules = [
            'sport' => [$presence, 'required', Rule::in(['football', 'basketball', 'tennis', 'cricket', 'boxing', 'esports'])],
            'league' => [$presence, 'required', 'string', 'max:120'],
            'country' => ['sometimes', 'nullable', 'string', 'max:80'],
            'home_name' => [$presence, 'required', 'string', 'max:120'],
            'away_name' => [$presence, 'required', 'string', 'max:120', 'different:home_name'],
            'starts_at' => [$presence, 'required', 'date'],
            'status' => [$presence, 'required', Rule::in(['draft', 'open', 'live', 'suspended'])],
            'odds_home' => [$presence, 'nullable', 'numeric', 'gt:1', 'max:1000', 'decimal:0,4'],
            'odds_draw' => ['sometimes', 'nullable', 'numeric', 'gt:1', 'max:1000', 'decimal:0,4'],
            'odds_away' => [$presence, 'nullable', 'numeric', 'gt:1', 'max:1000', 'decimal:0,4'],
        ];
        if ($updating) {
            $rules['version'] = ['required', 'integer', 'min:1'];
        }

        return $rules;
    }

    public function createEvent(Request $request, EventService $service): JsonResponse
    {
        $event = $service->create($this->input($request, $this->eventRules()), $request->user());

        return response()->json(['event' => StakingData::event($event)], 201);
    }

    public function updateEvent(Request $request, SportEvent $event, EventService $service): JsonResponse
    {
        $event = $service->update($event, $this->input($request, $this->eventRules(true)), $request->user());

        return response()->json(['event' => StakingData::event($event)]);
    }

    public function result(Request $request, SportEvent $event, SettlementService $service): JsonResponse
    {
        $input = $this->input($request, [
            'home_score' => ['required', 'integer', 'min:0', 'max:999'],
            'away_score' => ['required', 'integer', 'min:0', 'max:999'],
        ]);
        $event = $service->settleEvent($event, $input['home_score'], $input['away_score'], $request->user());

        return response()->json(['event' => StakingData::event($event)]);
    }

    public function void(Request $request, SportEvent $event, EventService $service): JsonResponse
    {
        $input = $this->input($request, ['reason' => ['sometimes', 'nullable', 'string', 'max:500']]);
        $event = $service->void($event, $request->user(), $input['reason'] ?? null);

        return response()->json(['event' => StakingData::event($event)]);
    }

    public function walletRequests(): JsonResponse
    {
        return response()->json(['requests' => WalletRequest::with('user')->latest()->limit(500)->get()
            ->map(fn ($item) => StakingData::walletRequest($item, true))])->header('Cache-Control', 'no-store');
    }

    public function review(Request $request, WalletRequest $walletRequest, WalletRequestService $service): JsonResponse
    {
        $input = $this->input($request, [
            'decision' => ['required', Rule::in(['approve', 'reject'])],
            'reference' => ['required', 'string', 'min:3', 'max:160'],
            'reason' => ['sometimes', 'nullable', 'string', 'max:160'],
        ]);
        $approved = $input['decision'] === 'approve';
        $item = $service->review($walletRequest, $approved, $request->user(), $approved ? $input['reference'] : ($input['reason'] ?? $input['reference']));

        return response()->json(['request' => StakingData::walletRequest($item, true)]);
    }

    public function copyPicks(): JsonResponse
    {
        return response()->json(['picks' => CopyPick::with('strategy', 'event')->latest()->limit(250)->get()->map(StakingData::pick(...))]);
    }

    public function publishPick(Request $request, CopyService $service): JsonResponse
    {
        $input = $this->input($request, [
            'strategy_id' => ['required', 'integer', 'exists:copy_strategies,id'],
            'event_id' => ['required', 'integer', 'exists:sport_events,id'],
            'outcome' => ['required', Rule::in(['home', 'draw', 'away'])],
        ]);
        $pick = $service->publishPick(CopyStrategy::findOrFail($input['strategy_id']), SportEvent::findOrFail($input['event_id']), $input['outcome'], $request->user());

        return response()->json(['pick' => StakingData::pick($pick)], 201);
    }

    public function users(): JsonResponse
    {
        return response()->json(['users' => User::latest()->limit(500)->get()->map(fn ($user) => [
            ...StakingData::user($user), 'balance_cents' => $user->wallet_balance,
            'created_at' => $user->created_at?->toIso8601String(),
        ])])->header('Cache-Control', 'no-store');
    }
}
