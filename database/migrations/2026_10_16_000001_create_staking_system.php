<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->unsignedBigInteger('wallet_balance')->default(0);
            $table->boolean('is_admin')->default(false);
        });
        Schema::create('sport_events', function (Blueprint $table) {
            $table->id();
            $table->string('sport', 40);
            $table->string('league', 120);
            $table->string('country', 80)->nullable();
            $table->string('home_name', 120);
            $table->string('away_name', 120);
            $table->dateTime('starts_at')->index();
            $table->string('status', 20)->default('draft')->index();
            $table->unsignedInteger('home_score')->nullable();
            $table->unsignedInteger('away_score')->nullable();
            $table->decimal('odds_home', 10, 4)->nullable();
            $table->decimal('odds_draw', 10, 4)->nullable();
            $table->decimal('odds_away', 10, 4)->nullable();
            $table->unsignedInteger('version')->default(1);
            $table->dateTime('settled_at')->nullable();
            $table->timestamps();
        });
        Schema::create('bets', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->restrictOnDelete();
            $table->string('reference', 100)->unique();
            $table->string('request_hash', 64);
            $table->string('type', 16);
            $table->unsignedBigInteger('stake');
            $table->string('status', 16)->default('pending')->index();
            $table->unsignedBigInteger('payout')->default(0);
            $table->dateTime('settled_at')->nullable();
            $table->timestamps();
        });
        Schema::create('bet_selections', function (Blueprint $table) {
            $table->id();
            $table->foreignId('bet_id')->constrained()->restrictOnDelete();
            $table->foreignId('sport_event_id')->constrained()->restrictOnDelete();
            $table->string('outcome', 8);
            $table->decimal('odds', 10, 4);
            $table->string('status', 16)->default('pending')->index();
            $table->timestamps();
            $table->unique(['bet_id', 'sport_event_id']);
        });
        Schema::create('wallet_transactions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->restrictOnDelete();
            $table->string('reference', 120)->unique();
            $table->string('type', 24);
            $table->bigInteger('amount');
            $table->unsignedBigInteger('balance_after');
            $table->json('metadata')->nullable();
            $table->timestamps();
        });
        Schema::create('wallet_requests', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->restrictOnDelete();
            $table->string('reference', 100)->unique();
            $table->string('request_hash', 64);
            $table->string('type', 16);
            $table->unsignedBigInteger('amount');
            $table->string('status', 16)->default('pending')->index();
            $table->string('method', 80);
            $table->json('details')->nullable();
            $table->string('admin_reference', 160)->nullable()->unique();
            $table->text('review_note')->nullable();
            $table->foreignId('reviewed_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->dateTime('reviewed_at')->nullable();
            $table->timestamps();
        });
        Schema::create('admin_audits', function (Blueprint $table) {
            $table->id();
            $table->foreignId('actor_id')->constrained('users')->restrictOnDelete();
            $table->string('action', 80);
            $table->text('reason')->nullable();
            $table->string('subject_type', 80);
            $table->unsignedBigInteger('subject_id');
            $table->json('before')->nullable();
            $table->json('after')->nullable();
            $table->timestamps();
        });
        Schema::create('copy_strategies', function (Blueprint $table) {
            $table->id();
            $table->string('name', 100);
            $table->string('slug', 100)->unique();
            $table->string('sport', 40);
            $table->text('description');
            $table->string('risk', 20)->default('moderate');
            $table->unsignedSmallInteger('stake_percentage')->default(10);
            $table->boolean('active')->default(true);
            $table->timestamps();
        });
        Schema::create('copy_positions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->restrictOnDelete();
            $table->foreignId('copy_strategy_id')->constrained()->restrictOnDelete();
            $table->string('funding_reference', 100)->unique();
            $table->unsignedBigInteger('principal');
            $table->unsignedBigInteger('value');
            $table->bigInteger('profit')->default(0);
            $table->string('status', 16)->default('active')->index();
            $table->timestamps();
        });
        Schema::create('copy_picks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('copy_strategy_id')->constrained()->restrictOnDelete();
            $table->foreignId('sport_event_id')->constrained()->restrictOnDelete();
            $table->string('outcome', 8);
            $table->decimal('odds', 10, 4);
            $table->foreignId('published_by')->constrained('users')->restrictOnDelete();
            $table->timestamps();
            $table->unique(['copy_strategy_id', 'sport_event_id']);
        });
        Schema::create('copy_stakes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('copy_position_id')->constrained()->restrictOnDelete();
            $table->foreignId('copy_pick_id')->constrained()->restrictOnDelete();
            $table->unsignedBigInteger('stake');
            $table->decimal('odds', 10, 4);
            $table->string('status', 16)->default('pending')->index();
            $table->unsignedBigInteger('payout')->default(0);
            $table->dateTime('settled_at')->nullable();
            $table->timestamps();
            $table->unique(['copy_position_id', 'copy_pick_id']);
        });
    }

    public function down(): void
    {
        foreach (['copy_stakes', 'copy_picks', 'copy_positions', 'copy_strategies', 'admin_audits', 'wallet_requests', 'wallet_transactions', 'bet_selections', 'bets', 'sport_events'] as $name) {
            Schema::dropIfExists($name);
        }
        Schema::table('users', fn (Blueprint $table) => $table->dropColumn(['wallet_balance', 'is_admin']));
    }
};
