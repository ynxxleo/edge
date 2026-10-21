<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\ValidationException;

class AuthController extends ApiController
{
    public function session(Request $request): JsonResponse
    {
        return response()->json([
            'user' => $this->userData($request->user()),
            'csrf_token' => csrf_token(),
            'currency' => \App\Services\StakingCurrency::code(),
            'payment_mode' => 'manual_review',
            'deposit_instructions' => config('staking.deposit_instructions'),
            'payment_methods' => app(\App\Services\PaymentSettingsService::class)->publicMethods(),
        ])->header('Cache-Control', 'no-store');
    }

    public function register(Request $request): JsonResponse
    {
        $this->normalizeEmail($request);
        $input = $this->input($request, [
            'name' => ['required', 'string', 'min:2', 'max:80'],
            'email' => ['required', 'email:rfc', 'max:254', 'unique:users,email'],
            'password' => ['required', 'string', 'max:128', Password::min(12)->letters()->numbers()],
            'password_confirmation' => ['required', 'same:password'],
        ]);
        $user = User::create(collect($input)->only('name', 'email', 'password')->all());
        Auth::login($user);
        $request->session()->regenerate();

        return $this->session($request)->setStatusCode(201);
    }

    public function login(Request $request): JsonResponse
    {
        $this->normalizeEmail($request);
        $input = $this->input($request, [
            'email' => ['required', 'email:rfc', 'max:254'],
            'password' => ['required', 'string', 'max:128'],
        ]);
        if (! Auth::attempt($input)) {
            throw ValidationException::withMessages(['email' => ['The email or password is incorrect.']]);
        }
        $request->session()->regenerate();

        return $this->session($request);
    }

    public function logout(Request $request): JsonResponse
    {
        $this->input($request, []);
        Auth::logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return $this->session($request);
    }

    private function normalizeEmail(Request $request): void
    {
        if (is_string($request->input('email'))) {
            $request->merge(['email' => Str::lower(trim($request->input('email')))]);
        }
    }
}
