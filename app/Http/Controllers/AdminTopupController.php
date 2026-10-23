<?php

namespace App\Http\Controllers;

use App\Models\AdminWalletTopup;
use App\Models\User;
use App\Services\AdminTopupService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AdminTopupController extends ApiController
{
    public function users(Request $request): JsonResponse
    {
        $input = $this->input($request, ['search' => ['sometimes', 'nullable', 'string', 'max:100']]);
        $search = trim($input['search'] ?? '');
        $users = User::when($search !== '', fn ($query) => $query->where(fn ($where) => $where
            ->where('name', 'like', '%'.$search.'%')->orWhere('email', 'like', '%'.$search.'%')->orWhere('internal_account_number', 'like', '%'.$search.'%')))
            ->latest('id')->limit(20)->get();
        return $this->json(['users' => $users->map(fn ($user) => [
            'id' => $user->id, 'name' => $user->name, 'email' => $user->email,
            'account_number' => $user->internal_account_number, 'balance_cents' => $user->wallet_balance,
        ])]);
    }

    public function index(Request $request): JsonResponse
    {
        $this->input($request, ['page' => ['sometimes', 'integer', 'min:1', 'max:100000']]);
        $rows = AdminWalletTopup::with('user', 'admin')->latest('id')->paginate(20);
        return $this->json(['topups' => $rows->map(fn ($record) => $record->adminData()),
            'pagination' => ['current_page' => $rows->currentPage(), 'last_page' => $rows->lastPage(), 'total' => $rows->total()],
        ]);
    }

    public function store(Request $request, User $user, AdminTopupService $service): JsonResponse
    {
        $result = $service->credit($request->user(), $user, $this->input($request, AdminTopupService::rules()));
        return $this->json(['topup' => $result['topup']->adminData(), 'idempotent' => $result['idempotent']], $result['idempotent'] ? 200 : 201);
    }

    private function json(array $data, int $status = 200): JsonResponse
    {
        return response()->json($data, $status)->header('Cache-Control', 'private, no-store')->header('X-Content-Type-Options', 'nosniff');
    }
}
