<?php

use Illuminate\Support\Facades\Route;

// Wallet activity in this UI is virtual and persisted only in browser storage.
Route::view('/', 'app')->name('home');
