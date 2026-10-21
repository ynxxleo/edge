<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payment_settings', function (Blueprint $table): void {
            $table->unsignedTinyInteger('id')->primary();
            $table->unsignedInteger('version')->default(1);
            $table->boolean('stripe_enabled')->default(false);
            $table->string('stripe_mode', 8)->default('test');
            $table->text('stripe_publishable_key')->nullable();
            $table->text('stripe_secret_key')->nullable();
            $table->text('stripe_webhook_secret')->nullable();
            $table->text('previous_webhook_secrets')->nullable();
            $table->boolean('manual_enabled')->default(true);
            foreach (['manual_bank_name', 'manual_account_name', 'manual_account_number', 'manual_instructions', 'manual_reference_label', 'manual_support_contact'] as $field) {
                $table->text($field)->nullable();
            }
            $table->timestamps();
        });
        DB::table('payment_settings')->insert(['id' => 1, 'version' => 1, 'stripe_enabled' => false, 'stripe_mode' => 'test', 'manual_enabled' => true, 'created_at' => now(), 'updated_at' => now()]);

        Schema::create('stripe_payments', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('user_id')->constrained()->restrictOnDelete();
            $table->string('reference', 100)->unique();
            $table->string('request_hash', 64);
            $table->unsignedBigInteger('amount');
            $table->string('currency', 3)->default('NGN');
            $table->string('mode', 8);
            $table->string('status', 16)->default('pending')->index();
            $table->string('session_id', 255)->nullable()->unique();
            $table->string('payment_intent_id', 255)->nullable()->unique();
            $table->text('checkout_url')->nullable();
            // Retained only while an ambiguous provider request can still be retried.
            $table->text('pending_secret_key')->nullable();
            $table->text('pending_payload')->nullable();
            $table->dateTime('paid_at')->nullable();
            $table->timestamps();
            $table->index(['user_id', 'created_at']);
        });
        Schema::create('stripe_webhook_events', function (Blueprint $table): void {
            $table->id();
            $table->string('event_id', 255)->unique();
            $table->string('payload_hash', 64);
            $table->foreignId('stripe_payment_id')->nullable()->constrained()->restrictOnDelete();
            $table->string('type', 100);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('stripe_webhook_events');
        Schema::dropIfExists('stripe_payments');
        Schema::dropIfExists('payment_settings');
    }
};
