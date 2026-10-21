<?php

// Only required by disposable HTTP test routers, never by the application.
if (! app()->environment(['local', 'testing']) || config('database.default') !== 'sqlite') {
    throw new RuntimeException('OTP fixture requires an isolated SQLite test app.');
}
config(['mail.default' => 'array']);
Illuminate\Support\Facades\Event::listen(Illuminate\Mail\Events\MessageSending::class, function ($event) {
    preg_match('/letter-spacing:8px">([0-9]{6})</', $event->message->getHtmlBody(), $match);
    file_put_contents(config('database.connections.sqlite.database').'.otp-mail.json', json_encode(['code' => $match[1]]));
    $email = $event->message->getTo()[0]->getAddress();
    // Financial regression fixtures log out and back in without waiting a minute.
    Illuminate\Support\Facades\RateLimiter::clear('otp:cooldown:'.hash('sha256', $email));
});
