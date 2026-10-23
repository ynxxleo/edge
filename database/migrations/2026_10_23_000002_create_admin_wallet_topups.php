<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('admin_wallet_topups', function (Blueprint $table) {
            $table->id();
            $table->string('reference', 100)->unique();
            $table->foreignId('user_id')->constrained('users')->restrictOnDelete();
            $table->foreignId('admin_id')->constrained('users')->restrictOnDelete();
            $table->foreignId('wallet_transaction_id')->unique()->constrained('wallet_transactions')->restrictOnDelete();
            $table->unsignedBigInteger('amount');
            $table->unsignedBigInteger('balance_before');
            $table->unsignedBigInteger('balance_after');
            $table->text('reason');
            $table->string('request_hash', 64);
            $table->timestamp('created_at');
            $table->index(['user_id', 'id']);
            $table->index(['admin_id', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('admin_wallet_topups');
    }
};
