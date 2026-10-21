<?php

namespace App\Http\Controllers;

use App\Models\Bet;
use App\Models\CopyPosition;
use App\Models\CopyStrategy;
use App\Models\SportEvent;
use App\Models\WalletRequest;
use App\Models\WalletTransaction;
use App\Services\BettingService;
use App\Services\CopyService;
use App\Services\WalletRequestService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class StakingController extends ApiController
{
    public function events(): JsonResponse
    {
        return response()->json(['events' => SportEvent::where('status', '!=', 'draft')
            ->orderBy('starts_at')->get()->map(StakingData::event(...))]);
    }

    public function strategies(): JsonResponse
    {
        return response()->json(['strategies' => CopyStrategy::where('active', true)->get()->map(StakingData::strategy(...))]);
    }

    public function state(Request $request): JsonResponse
    {
        $user = $request->user()->fresh();
        $bets = Bet::where('user_id', $user->id)->with('selections.event')->latest()->get();
        $positions = CopyPosition::where('user_id', $user->id)->with('strategy', 'stakes.pick.event')->latest()->get();
        $profit = $bets->where('status', '!=', 'pending')->sum(fn ($bet) => $bet->payout - $bet->stake)
            + $positions->sum('profit');
        $betData = $bets->map(StakingData::bet(...));

        return response()->json([
            'user' => StakingData::user($user), 'currency' => \App\Services\StakingCurrency::code(), 'balance_cents' => $user->wallet_balance,
            'profit_cents' => (int) $profit,
            'active_stakes_cents' => (int) $bets->where('status', 'pending')->sum('stake'),
            'potential_returns_cents' => (int) $betData->where('status', 'pending')->sum('potential_return_cents'),
            'bets' => $betData,
            'transactions' => WalletTransaction::where('user_id', $user->id)->latest()->limit(250)->get()->map(fn ($transaction) => [
                'id' => $transaction->id, 'reference' => $transaction->reference, 'type' => $transaction->type,
                'amount_cents' => $transaction->amount, 'balance_after_cents' => $transaction->balance_after,
                'metadata' => $transaction->metadata, 'created_at' => $transaction->created_at?->toIso8601String(),
            ]),
            'copy_positions' => $positions->map(StakingData::position(...)),
            'wallet_requests' => WalletRequest::where('user_id', $user->id)->latest()->limit(250)->get()->map(fn ($item) => StakingData::walletRequest($item)),
            'stripe_payments' => \App\Models\StripePayment::where('user_id', $user->id)->latest()->limit(100)->get()->map(fn ($payment) => $payment->publicData()),
        ])->header('Cache-Control', 'no-store');
    }

    public function placeBet(Request $request, BettingService $service): JsonResponse
    {
        $input = $this->input($request, [
            'type' => ['required', Rule::in(['single', 'multiple'])],
            'stake_cents' => ['required', 'integer', 'min:100', 'max:100000000'],
            'idempotency_key' => ['required', 'string', 'min:8', 'max:100', 'regex:/^[a-zA-Z0-9_.:-]+$/'],
            'selections' => ['required', 'array', 'min:1', 'max:20'],
            'selections.*' => ['required', 'array:event_id,outcome,expected_odds,expected_version'],
            'selections.*.event_id' => ['required', 'integer', 'distinct', 'exists:sport_events,id'],
            'selections.*.outcome' => ['required', Rule::in(['home', 'draw', 'away'])],
            'selections.*.expected_odds' => ['required', 'numeric', 'min:1.0001', 'max:1000'],
            'selections.*.expected_version' => ['required', 'integer', 'min:1'],
        ]);
        $bet = $service->place($request->user(), $input['selections'], $input['stake_cents'], $input['type'], $input['idempotency_key']);

        return response()->json(['bet' => StakingData::bet($bet)], 201);
    }

    public function walletRequest(Request $request, WalletRequestService $service): JsonResponse
    {
        $custom = is_string($request->input('method')) && str_starts_with($request->input('method'), 'manual:');
        $detailRules = $custom ? [
            'details' => ['required', 'array:reference,answers,method_version,note'],
            'details.method_version' => ['required', 'integer', 'min:1'],
            'details.reference' => ['required_if:type,deposit', 'nullable', 'string', 'max:160'],
            'details.answers' => ['sometimes', 'array', 'max:12'],
            'details.note' => ['nullable', 'string', 'max:500'],
        ] : [
            'details' => ['required', 'array:reference,bank_name,account_name,account_number,note'],
            'details.reference' => ['required_if:type,deposit', 'nullable', 'string', 'max:160'],
            'details.bank_name' => ['required_if:type,withdrawal', 'nullable', 'string', 'min:2', 'max:100'],
            'details.account_name' => ['required_if:type,withdrawal', 'nullable', 'string', 'min:2', 'max:100'],
            'details.account_number' => ['required_if:type,withdrawal', 'nullable', 'string', 'regex:/^[0-9]{8,20}$/'],
            'details.note' => ['nullable', 'string', 'max:500'],
        ];
        $input = $this->input($request, [
            'type' => ['required', Rule::in(['deposit', 'withdrawal'])],
            'amount_cents' => ['required', 'integer', 'min:10000', 'max:100000000'],
            'method' => ['required', 'string', 'max:80', 'regex:/\A(?:bank_transfer|bank|manual:[1-9][0-9]*)\z/D'],
            'idempotency_key' => ['required', 'string', 'min:8', 'max:100', 'regex:/^[a-zA-Z0-9_.:-]+$/'],
            ...$detailRules,
        ]);
        $item = $service->create($request->user(), $input['type'], $input['amount_cents'], $input['method'], $input['details'], $input['idempotency_key']);

        return response()->json(['request' => StakingData::walletRequest($item)], 201);
    }

    public function fundCopy(Request $request, CopyService $service): JsonResponse
    {
        $input = $this->input($request, [
            'strategy_id' => ['required', 'integer', 'exists:copy_strategies,id'],
            'amount_cents' => ['required', 'integer', 'min:10000', 'max:100000000'],
            'idempotency_key' => ['required', 'string', 'min:8', 'max:100', 'regex:/^[a-zA-Z0-9_.:-]+$/'],
        ]);
        $position = $service->fund($request->user(), CopyStrategy::findOrFail($input['strategy_id']), $input['amount_cents'], $input['idempotency_key']);

        return response()->json(['position' => StakingData::position($position)], 201);
    }

    public function updateCopy(Request $request, CopyPosition $position, CopyService $service): JsonResponse
    {
        abort_unless((int) $position->user_id === (int) $request->user()->id, 404);
        $input = $this->input($request, ['status' => ['required', Rule::in(['active', 'paused'])]]);
        $position = $service->changeStatus($position, $input['status']);

        return response()->json(['position' => StakingData::position($position)]);
    }

    public function closeCopy(Request $request, CopyPosition $position, CopyService $service): JsonResponse
    {
        abort_unless((int) $position->user_id === (int) $request->user()->id, 404);
        $this->input($request, []);
        $position = $service->close($position);

        return response()->json(['position' => StakingData::position($position)]);
    }
}
