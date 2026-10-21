<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('staking_mutexes', function (Blueprint $table) {
            $table->unsignedTinyInteger('id')->primary();
            $table->unsignedTinyInteger('token')->default(0);
        });
        DB::table('staking_mutexes')->insert(['id' => 1, 'token' => 0]);
    }

    public function down(): void
    {
        Schema::dropIfExists('staking_mutexes');
    }
};
