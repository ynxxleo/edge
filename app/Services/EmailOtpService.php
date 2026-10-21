<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class EmailOtpService
{
    public function send(Request $request, array $payload): array
    {
        $emailKey = hash('sha256', $payload['email']);
        $cooldown = 'otp:cooldown:'.$emailKey;
        $hourly = 'otp:hour:'.$emailKey;
        if (RateLimiter::tooManyAttempts($cooldown, 1) || RateLimiter::tooManyAttempts($hourly, 8)) {
            throw ValidationException::withMessages(['email' => ['Please wait before requesting another code.']]);
        }
        // Log and array transports must never silently strand production accounts.
        if (app()->isProduction() && ! in_array(config('mail.default'), ['smtp', 'sendmail', 'ses', 'postmark', 'resend'], true)) {
            abort(503, 'Email verification is temporarily unavailable. Please try again later.');
        }
        RateLimiter::hit($cooldown, 60);
        RateLimiter::hit($hourly, 3600);
        $id = (string) Str::uuid();
        $code = (string) random_int(100000, 999999);
        DB::table('auth_challenges')->insert([
            'id' => $id, 'payload' => Crypt::encryptString(json_encode($payload, JSON_THROW_ON_ERROR)),
            'code_hash' => Hash::make($code), 'attempts' => 0,
            'expires_at' => now()->addMinutes(10), 'created_at' => now(),
        ]);
        try {
            Mail::send('mail.auth-code', ['code' => $code, 'purpose' => $payload['purpose']], function ($message) use ($payload) {
                $message->to($payload['email'])->subject('Your EDGE verification code');
            });
        } catch (\Throwable $exception) {
            DB::table('auth_challenges')->where('id', $id)->delete();
            // Do not log exception messages which may contain mail bodies or SMTP credentials.
            \Illuminate\Support\Facades\Log::warning('OTP email delivery failed.', ['exception_type' => get_class($exception)]);
            abort(503, 'We could not send your code. Please try again in a minute.');
        }
        if ($previous = $request->session()->get('auth_challenge_id')) {
            DB::table('auth_challenges')->where('id', $previous)->delete();
        }
        $request->session()->put('auth_challenge_id', $id);
        return $this->status($request);
    }

    public function status(Request $request): ?array
    {
        $row = DB::table('auth_challenges')->where('id', $request->session()->get('auth_challenge_id', ''))->first();
        if (! $row || now()->gte($row->expires_at) || $row->attempts >= 5) {
            return null;
        }
        $payload = json_decode(Crypt::decryptString($row->payload), true, 512, JSON_THROW_ON_ERROR);
        [$name, $domain] = explode('@', $payload['email'], 2);
        return ['requires_otp' => true, 'email_hint' => substr($name, 0, 1).'***@'.$domain,
            'expires_at' => \Illuminate\Support\Carbon::parse($row->expires_at)->toIso8601String(),
            'resend_after' => RateLimiter::availableIn('otp:cooldown:'.hash('sha256', $payload['email']))];
    }

    public function resend(Request $request): array
    {
        $row = DB::table('auth_challenges')->where('id', $request->session()->get('auth_challenge_id', ''))->first();
        if (! $row || now()->gte(\Illuminate\Support\Carbon::parse($row->created_at)->addHour())) {
            throw ValidationException::withMessages(['code' => ['Please enter your account details again.']]);
        }
        return $this->send($request, json_decode(Crypt::decryptString($row->payload), true, 512, JSON_THROW_ON_ERROR));
    }

    public function verify(Request $request, string $code): void
    {
        // Return errors after committing so incorrect attempts are never rolled back.
        try {
            $result = DB::transaction(function () use ($request, $code) {
                $row = DB::table('auth_challenges')->where('id', $request->session()->get('auth_challenge_id', ''))->lockForUpdate()->first();
                if (! $row || now()->gte($row->expires_at) || $row->attempts >= 5) {
                    return null;
                }
                if (! Hash::check($code, $row->code_hash)) {
                    DB::table('auth_challenges')->where('id', $row->id)->increment('attempts');
                    return null;
                }
                $payload = json_decode(Crypt::decryptString($row->payload), true, 512, JSON_THROW_ON_ERROR);
                DB::table('auth_challenges')->where('id', $row->id)->delete();
                if ($payload['purpose'] === 'register') {
                    if (User::where('email', $payload['email'])->exists()) {
                        return null;
                    }
                    $user = User::create(['name' => $payload['name'], 'email' => $payload['email'], 'password' => $payload['password_hash']]);
                } else {
                    $user = User::where('id', $payload['user_id'])->lockForUpdate()->first();
                    if (! $user || $user->email !== $payload['email'] || ! hash_equals($user->password, $payload['password_hash'])) {
                        return null;
                    }
                }
                $user->email_verified_at = $user->email_verified_at ?: now();
                $user->save();
                return $user;
            });
        } catch (UniqueConstraintViolationException) {
            // A competing verified registration may have claimed the same email.
            $result = null;
        }
        if (! $result) {
            throw ValidationException::withMessages(['code' => ['That code is incorrect or expired. Codes allow five attempts.']]);
        }
        $request->session()->forget('auth_challenge_id');
        Auth::login($result);
        $request->session()->regenerate();
    }
}
