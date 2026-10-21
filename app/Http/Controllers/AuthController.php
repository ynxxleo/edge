<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Services\EmailOtpService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\ValidationException;

class AuthController extends ApiController
{
    public function session(Request $request): JsonResponse
    {
        return response()->json([
            'user' => $this->userData($request->user()),
            'auth_challenge' => app(EmailOtpService::class)->status($request),
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
        return response()->json(app(EmailOtpService::class)->send($request, [
            'purpose' => 'register', 'name' => $input['name'], 'email' => $input['email'],
            'password_hash' => Hash::make($input['password']),
        ]), 202)->header('Cache-Control', 'no-store');
    }

    public function login(Request $request): JsonResponse
    {
        $this->normalizeEmail($request);
        $input = $this->input($request, [
            'email' => ['required', 'email:rfc', 'max:254'],
            'password' => ['required', 'string', 'max:128'],
        ]);
        $user = User::where('email', $input['email'])->first();
        if (! Hash::check($input['password'], $user?->password ?? '$2y$12$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi.')) {
            throw ValidationException::withMessages(['email' => ['The email or password is incorrect.']]);
        }
        if (! $user) {
            throw ValidationException::withMessages(['email' => ['The email or password is incorrect.']]);
        }
        return response()->json(app(EmailOtpService::class)->send($request, [
            'purpose' => 'login', 'user_id' => $user->id, 'email' => $user->email,
            'password_hash' => $user->password,
        ]), 202)->header('Cache-Control', 'no-store');
    }

    public function verify(Request $request): JsonResponse
    {
        $input = $this->input($request, ['code' => ['required', 'string', 'regex:/^[0-9]{6}$/']]);
        app(EmailOtpService::class)->verify($request, $input['code']);
        return $this->session($request);
    }

    public function resend(Request $request): JsonResponse
    {
        $this->input($request, []);
        return response()->json(app(EmailOtpService::class)->resend($request))->header('Cache-Control', 'no-store');
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
