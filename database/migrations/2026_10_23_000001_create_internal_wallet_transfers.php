<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('users', fn (Blueprint $table) => $table->string('internal_account_number', 10)->nullable()->unique());
        DB::table('users')->orderBy('id')->chunkById(100, function ($users) {
            foreach ($users as $user) {
                if ($user->internal_account_number !== null) {
                    continue;
                }
                do {
                    $number = (string) random_int(1000000000, 9999999999);
                } while (DB::table('users')->where('internal_account_number', $number)->exists());
                DB::table('users')->where('id', $user->id)->whereNull('internal_account_number')->update(['internal_account_number' => $number]);
            }
        });
        Schema::create('wallet_transfers', function (Blueprint $table) {
            $table->id();
            $table->string('reference', 100)->unique();
            $table->foreignId('sender_id')->constrained('users')->restrictOnDelete();
            $table->foreignId('recipient_id')->constrained('users')->restrictOnDelete();
            $table->unsignedBigInteger('amount');
            $table->string('request_hash', 64);
            $table->timestamp('created_at');
            $table->index(['sender_id', 'id']);
            $table->index(['recipient_id', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('wallet_transfers');
        Schema::table('users', fn (Blueprint $table) => $table->dropColumn('internal_account_number'));
    }
};
