<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('kyc_submissions', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('user_id')->constrained()->restrictOnDelete();
            $table->string('status', 16)->default('pending')->index();
            $table->unsignedInteger('version')->default(1);
            // Identity data and private file metadata use authenticated Laravel encryption.
            foreach (['legal_name', 'date_of_birth', 'country', 'address', 'document_type', 'document_number', 'documents', 'review_note'] as $field) {
                $table->text($field)->nullable();
            }
            $table->dateTime('consented_at');
            $table->foreignId('reviewed_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->dateTime('reviewed_at')->nullable();
            $table->timestamps();
            $table->index(['user_id', 'id']);
            $table->index(['status', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('kyc_submissions');
    }
};
