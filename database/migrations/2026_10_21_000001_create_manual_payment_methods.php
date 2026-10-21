<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('manual_payment_methods', function (Blueprint $table): void {
            $table->id();
            $table->string('name', 80);
            $table->longText('instructions');
            $table->longText('fields');
            $table->boolean('enabled')->default(true);
            $table->boolean('deposit_enabled')->default(true);
            $table->boolean('withdrawal_enabled')->default(false);
            $table->unsignedInteger('version')->default(1);
            $table->longText('image_data');
            $table->string('image_mime', 30);
            $table->foreignId('updated_by')->constrained('users')->restrictOnDelete();
            $table->timestamps();
        });
        Schema::table('wallet_requests', function (Blueprint $table): void {
            $table->longText('manual_details')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('wallet_requests', fn (Blueprint $table) => $table->dropColumn('manual_details'));
        Schema::dropIfExists('manual_payment_methods');
    }
};
