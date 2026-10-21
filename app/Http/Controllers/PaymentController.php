<?php

namespace App\Http\Controllers;

use App\Models\StripePayment;
use App\Services\PaymentSettingsService;
use App\Services\StripePaymentService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PaymentController extends ApiController
{
    public function methods(PaymentSettingsService $settings): JsonResponse
    {
        return response()->json($settings->publicMethods())->header('Cache-Control', 'no-store');
    }

    public function checkout(Request $request, StripePaymentService $stripe): JsonResponse
    {
        $input = $this->input($request, [
            'amount_cents' => ['required', 'integer', 'min:10000', 'max:99999999'],
            'idempotency_key' => ['required', 'string', 'min:8', 'max:100', 'regex:/^[a-zA-Z0-9_.:-]+$/'],
        ]);
        $payment = $stripe->checkout($request->user(), $input['amount_cents'], $input['idempotency_key']);
        return response()->json([
            'checkout_url' => $payment->status === 'paid' ? null : $payment->checkout_url,
            'reference' => $payment->reference, 'session_id' => $payment->session_id, 'mode' => $payment->mode,
            'payment' => $payment->publicData(),
        ], 201)->header('Cache-Control', 'no-store');
    }

    public function status(Request $request, string $reference): JsonResponse
    {
        $payment = StripePayment::where('reference', $reference)->where('user_id', $request->user()->id)->firstOrFail();
        return response()->json(['payment' => $payment->publicData()])->header('Cache-Control', 'no-store');
    }

    public function webhook(Request $request, StripePaymentService $stripe): JsonResponse
    {
        return response()->json($stripe->webhook($request->getContent(), $request->header('Stripe-Signature', '')))->header('Cache-Control', 'no-store');
    }
}
