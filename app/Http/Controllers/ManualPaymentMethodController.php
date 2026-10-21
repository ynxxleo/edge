<?php

namespace App\Http\Controllers;

use App\Models\ManualPaymentMethod;
use App\Services\ManualPaymentMethodService;
use Illuminate\Http\Request;

class ManualPaymentMethodController extends ApiController
{
    public function index(ManualPaymentMethodService $service)
    {
        return response()->json(['methods' => ManualPaymentMethod::select('id', 'name', 'instructions', 'fields', 'enabled', 'deposit_enabled', 'withdrawal_enabled', 'version')->orderBy('id')->get()->map($service->data(...))])->header('Cache-Control', 'no-store, private');
    }

    public function store(Request $request, ManualPaymentMethodService $service)
    {
        return $this->save($request, $service);
    }

    public function update(Request $request, ManualPaymentMethod $manualPaymentMethod, ManualPaymentMethodService $service)
    {
        return $this->save($request, $service, $manualPaymentMethod);
    }

    private function save(Request $request, ManualPaymentMethodService $service, ?ManualPaymentMethod $method = null)
    {
        $input = $this->input($request, ['definition' => ['required', 'string', 'json', 'max:20000'],
            'current_password' => ['required', 'string', 'max:128'], 'image' => [$method ? 'nullable' : 'required', 'file', 'max:1024']]);
        $definition = json_decode($input['definition'], true, 512, JSON_THROW_ON_ERROR);
        abort_unless(is_array($definition) && ! array_is_list($definition), 422, 'Provide a payment method definition.');
        $saved = $service->save($request->user(), $definition, $input['current_password'], $request->file('image'), $method);
        return response()->json(['method' => $service->data($saved)], $method ? 200 : 201)->header('Cache-Control', 'no-store, private');
    }

    public function image(Request $request, ManualPaymentMethod $manualPaymentMethod)
    {
        abort_unless($manualPaymentMethod->enabled || $request->user()?->is_admin, 404);
        return response(base64_decode($manualPaymentMethod->image_data, true), 200, [
            'Content-Type' => $manualPaymentMethod->image_mime,
            'Cache-Control' => 'no-store, private', 'X-Content-Type-Options' => 'nosniff',
            'Content-Security-Policy' => "default-src 'none'; sandbox",
        ]);
    }
}
