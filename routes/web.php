<?php

use App\Http\Controllers\AdminController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\StakingController;
use App\Http\Controllers\PaymentController;
use App\Http\Controllers\PaymentSettingsController;
use App\Http\Controllers\KycController;
use App\Http\Controllers\KycRequirementsController;
use App\Http\Controllers\SupportController;
use App\Http\Controllers\PromoCodeController;
use App\Http\Controllers\ManualPaymentMethodController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

// The web group supplies session authentication and CSRF protection to every JSON endpoint.
Route::get('/', function (Request $request) {
    // Checkout sessions created before the landing page still return to this URL.
    if ($request->has('stripe_return')) {
        return redirect('/app?'.http_build_query($request->query()).'#wallet')->header('Cache-Control', 'no-store');
    }

    return view('landing');
})->name('home');
// Explicit public information routes; account and administrator URLs stay separate.
foreach (array_keys(config('marketing.pages', [])) as $pageIndex => $slug) {
    Route::get('/'.$slug, fn () => view('marketing.page', [
        'pageSlug' => $slug,
        'pageIndex' => $pageIndex + 1,
        'page' => config('marketing.pages.'.$slug),
    ]))->name('marketing.'.$slug);
}

Route::view('/app', 'app', ['serverMode' => 'laravel'])->name('platform');
Route::view('/admin', 'app', ['serverMode' => 'laravel']);

Route::prefix('api')->group(function (): void {
    Route::get('/session', [AuthController::class, 'session']);
    Route::post('/auth/register', [AuthController::class, 'register'])->middleware('throttle:6,1');
    Route::post('/auth/login', [AuthController::class, 'login'])->middleware('throttle:6,1');
    Route::post('/auth/verify', [AuthController::class, 'verify'])->middleware('throttle:12,1,otp-verify');
    Route::post('/auth/resend', [AuthController::class, 'resend'])->middleware('throttle:6,1,otp-resend');
    Route::post('/auth/logout', [AuthController::class, 'logout'])->middleware('auth');
    Route::get('/events', [StakingController::class, 'events']);
    Route::get('/copy/strategies', [StakingController::class, 'strategies']);
    Route::get('/payment-methods', [PaymentController::class, 'methods']);
    Route::post('/payments/stripe/webhook', [PaymentController::class, 'webhook'])->middleware('throttle:120,1');

    Route::middleware('auth')->group(function (): void {
        Route::get('/manual-payment-methods/{manualPaymentMethod}/image', [ManualPaymentMethodController::class, 'image']);
        Route::get('/wallet/transfers', [\App\Http\Controllers\TransferController::class, 'index']);
        Route::post('/wallet/transfers/recipient', [\App\Http\Controllers\TransferController::class, 'recipient'])->middleware('throttle:10,1,transfer-recipient');
        Route::post('/wallet/transfers', [\App\Http\Controllers\TransferController::class, 'store'])->middleware('throttle:6,1,transfer-send');
        Route::get('/state', [StakingController::class, 'state']);
        Route::get('/promo-codes', [PromoCodeController::class, 'index']);
        Route::post('/promo-codes/redeem', [PromoCodeController::class, 'redeem'])->middleware('throttle:6,1,promo-redeem');
        Route::get('/support', [SupportController::class, 'current']);
        Route::post('/support/conversations', [SupportController::class, 'start'])->middleware('throttle:10,1,support-start');
        Route::get('/support/conversations/{conversation}', [SupportController::class, 'show']);
        Route::post('/support/conversations/{conversation}/messages', [SupportController::class, 'message'])->middleware('throttle:20,1,support-message');
        Route::post('/support/conversations/{conversation}/handover', [SupportController::class, 'handover'])->middleware('throttle:10,1,support-handover');
        Route::get('/kyc', [KycController::class, 'show']);
        Route::post('/kyc', [KycController::class, 'store'])->middleware('throttle:6,10');
        Route::get('/kyc/{submission}/documents/{kind}', [KycController::class, 'document'])->middleware('throttle:120,1');
        Route::post('/bets', [StakingController::class, 'placeBet'])->middleware('throttle:30,1');
        Route::post('/wallet/requests', [StakingController::class, 'walletRequest'])->middleware('throttle:10,1');
        Route::post('/payments/stripe/checkout', [PaymentController::class, 'checkout'])->middleware('throttle:10,1');
        Route::get('/payments/stripe/{reference}', [PaymentController::class, 'status']);
        Route::post('/copy/positions', [StakingController::class, 'fundCopy'])->middleware('throttle:10,1');
        Route::patch('/copy/positions/{position}', [StakingController::class, 'updateCopy']);
        Route::post('/copy/positions/{position}/close', [StakingController::class, 'closeCopy']);

        Route::prefix('admin')->middleware('admin')->group(function (): void {
            Route::get('/promo-codes', [PromoCodeController::class, 'adminIndex']);
            Route::post('/promo-codes', [PromoCodeController::class, 'store'])->middleware('throttle:10,1,promo-issue');
            Route::post('/promo-codes/{promoCode}/revoke', [PromoCodeController::class, 'revoke'])->middleware('throttle:10,1,promo-revoke');
            Route::get('/support', [SupportController::class, 'inbox']);
            Route::get('/support/{conversation}', [SupportController::class, 'adminShow']);
            Route::post('/support/{conversation}/claim', [SupportController::class, 'claim'])->middleware('throttle:30,1,support-claim');
            Route::post('/support/{conversation}/reply', [SupportController::class, 'reply'])->middleware('throttle:30,1,support-reply');
            Route::post('/support/{conversation}/resolve', [SupportController::class, 'resolve'])->middleware('throttle:30,1,support-resolve');
            Route::get('/kyc', [KycController::class, 'adminIndex']);
            Route::get('/kyc/requirements', [KycRequirementsController::class, 'settings']);
            Route::put('/kyc/requirements', [KycRequirementsController::class, 'updateSettings'])->middleware('throttle:20,1');
            Route::get('/kyc/users', [KycRequirementsController::class, 'users']);
            Route::get('/kyc/users/{user}/requirements', [KycRequirementsController::class, 'showUser']);
            Route::put('/kyc/users/{user}/requirements', [KycRequirementsController::class, 'updateUser'])->middleware('throttle:30,1');
            Route::get('/kyc/{submission}', [KycController::class, 'adminShow']);
            Route::post('/kyc/{submission}/review', [KycController::class, 'review'])->middleware('throttle:30,1');
            Route::get('/overview', [AdminController::class, 'overview']);
            Route::get('/events', [AdminController::class, 'events']);
            Route::post('/events', [AdminController::class, 'createEvent']);
            Route::patch('/events/{event}', [AdminController::class, 'updateEvent']);
            Route::post('/events/{event}/result', [AdminController::class, 'result']);
            Route::post('/events/{event}/void', [AdminController::class, 'void']);
            Route::get('/wallet-requests', [AdminController::class, 'walletRequests']);
            Route::post('/wallet-requests/{walletRequest}/review', [AdminController::class, 'review']);
            Route::get('/copy-picks', [AdminController::class, 'copyPicks']);
            Route::post('/copy-picks', [AdminController::class, 'publishPick']);
            Route::get('/users', [AdminController::class, 'users']);
            Route::get('/manual-payment-methods', [ManualPaymentMethodController::class, 'index']);
            Route::post('/manual-payment-methods', [ManualPaymentMethodController::class, 'store'])->middleware('throttle:20,1,manual-methods');
            Route::post('/manual-payment-methods/{manualPaymentMethod}', [ManualPaymentMethodController::class, 'update'])->middleware('throttle:20,1,manual-methods');
            Route::get('/payment-settings', [PaymentSettingsController::class, 'show']);
            Route::patch('/payment-settings', [PaymentSettingsController::class, 'update'])->middleware('throttle:20,1');
        });
    });
});
