<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('support_conversations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->restrictOnDelete();
            // NULL on resolved threads; unique enforces one active chat per user.
            $table->foreignId('active_user_id')->nullable()->unique()->constrained('users')->restrictOnDelete();
            $table->string('status', 16)->default('bot')->index();
            $table->unsignedInteger('version')->default(1);
            $table->unsignedSmallInteger('bot_answers')->default(0);
            $table->foreignId('assigned_admin_id')->nullable()->constrained('users')->restrictOnDelete();
            $table->dateTime('last_message_at')->nullable()->index();
            $table->dateTime('resolved_at')->nullable();
            $table->timestamps();
            $table->index(['user_id', 'id']);
        });
        Schema::create('support_messages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('support_conversation_id')->constrained()->restrictOnDelete();
            $table->foreignId('sender_id')->nullable()->constrained('users')->restrictOnDelete();
            $table->string('role', 16);
            $table->text('body');
            $table->string('automation_mode', 16)->nullable();
            $table->string('idempotency_hash', 64)->nullable();
            $table->timestamps();
            $table->unique(['support_conversation_id', 'idempotency_hash']);
            $table->index(['support_conversation_id', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('support_messages');
        Schema::dropIfExists('support_conversations');
    }
};
