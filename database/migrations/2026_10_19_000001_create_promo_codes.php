<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('promo_codes', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('created_by')->constrained('users')->restrictOnDelete();
            $table->string('issuance_key_hash', 64);
            $table->string('request_hash', 64);
            $table->text('encrypted_code');
            $table->string('code_hash', 64)->unique();
            $table->string('code_last4', 4);
            $table->unsignedBigInteger('amount');
            $table->string('currency', 3);
            $table->string('label', 100)->nullable();
            $table->string('status', 16)->default('active')->index();
            $table->unsignedInteger('version')->default(1);
            $table->dateTime('expires_at')->nullable()->index();
            $table->foreignId('redeemed_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->dateTime('redeemed_at')->nullable();
            $table->foreignId('revoked_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->dateTime('revoked_at')->nullable();
            $table->timestamps();
            $table->unique(['created_by', 'issuance_key_hash']);
        });

        Schema::create('promo_code_redemptions', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('promo_code_id')->unique()->constrained()->restrictOnDelete();
            $table->foreignId('user_id')->constrained()->restrictOnDelete();
            $table->foreignId('wallet_transaction_id')->unique()->constrained()->restrictOnDelete();
            $table->unsignedBigInteger('amount');
            $table->string('currency', 3);
            $table->dateTime('redeemed_at');
            $table->timestamps();
            $table->index(['user_id', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('promo_code_redemptions');
        Schema::dropIfExists('promo_codes');
    }
};
