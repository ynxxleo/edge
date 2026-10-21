<?php

namespace App\Http\Controllers;

use App\Models\PromoCode;
use App\Models\PromoCodeRedemption;
use App\Services\PromoCodeService;
use App\Services\StakingCurrency;
use App\Services\StakingRules;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class PromoCodeController extends ApiController
{
    public function index(Request $request, PromoCodeService $service): JsonResponse
    {
        $this->input($request, ['page' => ['sometimes', 'integer', 'min:1']]);
        $rows = PromoCodeRedemption::with(['promoCode', 'transaction'])->where('user_id', $request->user()->id)->latest('id')->paginate(20);

        return $this->json([
            'redemptions' => $rows->getCollection()->map(fn ($redemption) => $service->redemptionData($redemption))->all(),
            'pagination' => $this->pagination($rows),
        ]);
    }

    public function redeem(Request $request, PromoCodeService $service): JsonResponse
    {
        $input = $this->input($request, PromoCodeService::redeemRules());
        $result = $service->redeem($request->user(), $input);

        return $this->json([
            'redemption' => $service->redemptionData($result['redemption']),
            'already_redeemed' => $result['already_redeemed'], 'wallet_balance_cents' => $result['wallet_balance_cents'],
        ]);
    }

    public function adminIndex(Request $request, PromoCodeService $service): JsonResponse
    {
        StakingRules::admin($request->user());
        $input = $this->input($request, [
            'status' => ['sometimes', Rule::in(['all', 'active', 'redeemed', 'revoked', 'expired'])],
            'page' => ['sometimes', 'integer', 'min:1'],
        ]);
        $status = $input['status'] ?? 'all';
        $query = PromoCode::with(['creator', 'redeemer']);
        if ($status === 'active') {
            $query->where('status', 'active')->where(fn ($where) => $where->whereNull('expires_at')->orWhere('expires_at', '>', now()));
        } elseif ($status === 'expired') {
            $query->where('status', 'active')->whereNotNull('expires_at')->where('expires_at', '<=', now());
        } elseif ($status !== 'all') {
            $query->where('status', $status);
        }
        $rows = $query->latest('id')->paginate(20);

        return $this->json([
            'promo_codes' => $rows->getCollection()->map(fn ($code) => $service->adminData($code))->all(),
            'pagination' => $this->pagination($rows), 'currency' => StakingCurrency::code(),
        ]);
    }

    public function store(Request $request, PromoCodeService $service): JsonResponse
    {
        StakingRules::admin($request->user());
        $input = $this->input($request, PromoCodeService::issueRules());
        $result = $service->issue($request->user(), $input);

        return $this->json([
            'promo_code' => $service->adminData($result['promo_code']), 'code' => $result['code'], 'idempotent' => $result['idempotent'],
        ], $result['idempotent'] ? 200 : 201);
    }

    public function revoke(Request $request, PromoCode $promoCode, PromoCodeService $service): JsonResponse
    {
        StakingRules::admin($request->user());
        $input = $this->input($request, PromoCodeService::revokeRules());
        $updated = $service->revoke($promoCode, $request->user(), $input);

        return $this->json(['promo_code' => $service->adminData($updated)]);
    }

    private function pagination($rows): array
    {
        return ['current_page' => $rows->currentPage(), 'last_page' => $rows->lastPage(), 'total' => $rows->total(), 'per_page' => $rows->perPage()];
    }

    private function json(array $data, int $status = 200): JsonResponse
    {
        return response()->json($data, $status)->header('Cache-Control', 'private, no-store, max-age=0')->header('Pragma', 'no-cache')->header('X-Content-Type-Options', 'nosniff');
    }
}
