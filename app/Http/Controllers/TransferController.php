<?php

namespace App\Http\Controllers;

use App\Models\WalletTransfer;
use App\Services\TransferService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class TransferController extends ApiController
{
    public function index(Request $request): JsonResponse
    {
        $this->input($request, ['page' => ['sometimes', 'integer', 'min:1', 'max:100000']]);
        $user = $request->user()->fresh();
        $records = WalletTransfer::where(fn ($query) => $query->where('sender_id', $user->id)->orWhere('recipient_id', $user->id))
            ->with('sender', 'recipient')->latest('id')->paginate(20);
        return response()->json(['account_number' => $user->internal_account_number,
            'transfers' => $records->map(fn ($record) => $record->publicData($user)),
            'pagination' => ['current_page' => $records->currentPage(), 'last_page' => $records->lastPage(), 'total' => $records->total()],
        ])->header('Cache-Control', 'no-store, private');
    }

    public function recipient(Request $request, TransferService $service): JsonResponse
    {
        $input = $this->input($request, ['account_number' => ['required', 'string', 'regex:/\A[1-9][0-9]{9}\z/D']]);
        return response()->json($service->preview($request->user(), $input['account_number']))->header('Cache-Control', 'no-store, private');
    }

    public function store(Request $request, TransferService $service): JsonResponse
    {
        $input = $this->input($request, [
            'account_number' => ['required', 'string', 'regex:/\A[1-9][0-9]{9}\z/D'],
            'amount_cents' => ['required', 'integer', 'min:100', 'max:100000000'],
            'confirmation_token' => ['required', 'string', 'max:3000'],
            'current_password' => ['required', 'string', 'max:128'],
            'idempotency_key' => ['required', 'string', 'min:8', 'max:100', 'regex:/\A[a-zA-Z0-9_.:-]+\z/D'],
        ]);
        $record = $service->send($request->user(), $input['account_number'], (int) $input['amount_cents'], $input['confirmation_token'], $input['current_password'], $input['idempotency_key']);
        return response()->json(['transfer' => $record->publicData($request->user())], 201)->header('Cache-Control', 'no-store, private');
    }
}
