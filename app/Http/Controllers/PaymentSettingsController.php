<?php

namespace App\Http\Controllers;

use App\Services\PaymentSettingsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class PaymentSettingsController extends ApiController
{
    public function show(PaymentSettingsService $settings): JsonResponse
    {
        return response()->json($settings->adminData())->header('Cache-Control', 'no-store');
    }

    public function update(Request $request, PaymentSettingsService $settings): JsonResponse
    {
        $input = $this->input($request, [
            'version' => ['required', 'integer', 'min:1'],
            'current_password' => ['required', 'string', 'max:128'],
            'stripe_enabled' => ['sometimes', 'boolean'],
            'stripe_mode' => ['sometimes', Rule::in(['test', 'live'])],
            'stripe_publishable_key' => ['sometimes', 'nullable', 'string', 'max:255'],
            'stripe_secret_key' => ['sometimes', 'nullable', 'string', 'max:255'],
            'stripe_webhook_secret' => ['sometimes', 'nullable', 'string', 'max:255'],
            'manual_enabled' => ['sometimes', 'boolean'],
            'manual_bank_name' => ['sometimes', 'nullable', 'string', 'max:100'],
            'manual_account_name' => ['sometimes', 'nullable', 'string', 'max:100'],
            'manual_account_number' => ['sometimes', 'nullable', 'string', 'regex:/^[0-9]{8,20}$/'],
            'manual_instructions' => ['sometimes', 'nullable', 'string', 'max:1500'],
            'manual_reference_label' => ['sometimes', 'nullable', 'string', 'max:80'],
            'manual_support_contact' => ['sometimes', 'nullable', 'string', 'max:160'],
        ]);
        $updated = $settings->update($request->user(), $input);
        return response()->json($settings->adminData($updated))->header('Cache-Control', 'no-store');
    }
}
