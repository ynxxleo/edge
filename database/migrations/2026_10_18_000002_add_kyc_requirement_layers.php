<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('kyc_requirement_settings', function (Blueprint $table): void {
            $table->id();
            $table->unsignedInteger('version')->default(1);
            $table->text('reason');
            $table->json('layers');
            $table->timestamps();
        });
        DB::table('kyc_requirement_settings')->insert([
            'id' => 1, 'version' => 1,
            'reason' => 'We ask for identity verification to help protect your account and review withdrawal eligibility. An administrator reviews your documents before withdrawals are enabled.',
            'layers' => '[]', 'created_at' => now(), 'updated_at' => now(),
        ]);
        Schema::create('kyc_user_requirements', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('user_id')->unique()->constrained()->restrictOnDelete();
            $table->unsignedInteger('version')->default(1);
            $table->json('layer_ids');
            // Assignment reasons and snapshots can contain user-specific information.
            $table->text('reason')->nullable();
            $table->text('layers');
            $table->foreignId('assigned_by')->constrained('users')->restrictOnDelete();
            $table->timestamps();
        });
        Schema::table('kyc_submissions', function (Blueprint $table): void {
            $table->unsignedInteger('requirements_version')->default(0);
            $table->text('requirements_snapshot')->nullable();
            $table->text('answers')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('kyc_submissions', fn (Blueprint $table) => $table->dropColumn(['requirements_version', 'requirements_snapshot', 'answers']));
        Schema::dropIfExists('kyc_user_requirements');
        Schema::dropIfExists('kyc_requirement_settings');
    }
};
