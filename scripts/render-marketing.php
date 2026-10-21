<?php

// Render the same Blade views for the build and DOM checks as Laravel serves.
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$pages = ['/'=> view('landing')->render()];
foreach (config('marketing.pages') as $slug => $page) {
    $pages['/'.$slug] = view('marketing.page', [
        'pageSlug' => $slug,
        'pageIndex' => count($pages),
        'page' => $page,
    ])->render();
}
echo json_encode($pages, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
