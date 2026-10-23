<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use App\Http\Middleware\RequireAdmin;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->alias(['admin' => RequireAdmin::class]);
        $middleware->redirectGuestsTo(fn (Request $request) => '/?login=1');
        // Only Stripe's signed, server-to-server endpoint bypasses browser CSRF.
        $middleware->preventRequestForgery(except: ['api/payments/stripe/webhook']);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->dontFlash(['current_password', 'password', 'password_confirmation', 'stripe_secret_key', 'stripe_webhook_secret', 'legal_name', 'date_of_birth', 'country', 'address', 'document_number', 'id_document', 'selfie', 'answers', 'reason', 'body', 'code', 'definition', 'image', 'details']);
        $exceptions->respond(function ($response, \Throwable $error, Request $request) {
            if ($request->is('api/wallet/transfers', 'api/wallet/transfers/*')) {
                if ($response->getStatusCode() >= 500) {
                    $response = response()->json(['message' => 'The transfer could not be confirmed. Check your transfer history before retrying.'], $response->getStatusCode());
                }
                $response->headers->set('Cache-Control', 'no-store, private');
                $response->headers->set('X-Content-Type-Options', 'nosniff');
            }
            if ($request->is('api/promo-codes', 'api/promo-codes/*', 'api/admin/promo-codes', 'api/admin/promo-codes/*')) {
                if ($response->getStatusCode() >= 500) {
                    $response = response()->json(['message' => 'The credit code request could not be completed. Please try again.'], $response->getStatusCode());
                }
                $response->headers->set('Cache-Control', 'no-store, private');
                $response->headers->set('X-Content-Type-Options', 'nosniff');
            }
            if ($request->is('api/support', 'api/support/*', 'api/admin/support', 'api/admin/support/*')) {
                if ($response->getStatusCode() >= 500) {
                    $response = response()->json(['message' => 'Support could not be reached. Please try again.'], $response->getStatusCode());
                }
                $response->headers->set('Cache-Control', 'no-store, private');
                $response->headers->set('X-Content-Type-Options', 'nosniff');
            }
            if ($request->is('api/kyc', 'api/kyc/*', 'api/admin/kyc', 'api/admin/kyc/*')) {
                if ($response->getStatusCode() >= 500) {
                    $response = response()->json(['message' => 'Identity verification could not be completed. Please try again or contact support.'], $response->getStatusCode());
                }
                $response->headers->set('Cache-Control', 'no-store, private');
                $response->headers->set('X-Content-Type-Options', 'nosniff');
            }
            if ($request->is('api/admin/manual-payment-methods', 'api/admin/manual-payment-methods/*', 'api/manual-payment-methods/*')) {
                if ($response->getStatusCode() >= 500) {
                    $response = response()->json(['message' => 'The payment method could not be processed. Please try again.'], $response->getStatusCode());
                }
                $response->headers->set('Cache-Control', 'no-store, private');
                $response->headers->set('X-Content-Type-Options', 'nosniff');
            }
            if ($request->is('api/admin/payment-settings') || $request->is('api/payment-methods') || $request->is('api/payments/*')) {
                $response->headers->set('Cache-Control', 'no-store');
            }
            return $response;
        });
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
    })->create();
