<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Schedule::call(fn () => \Illuminate\Support\Facades\DB::table('auth_challenges')->where('expires_at', '<', now()->subHour())->delete())->hourly()->name('auth-challenges-prune')->withoutOverlapping();

Schedule::command('edge:payments-prune-secrets')->hourly()->withoutOverlapping();

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');
