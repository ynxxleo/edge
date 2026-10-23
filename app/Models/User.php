<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;

#[Fillable(['name', 'email', 'password'])]
#[Hidden(['password', 'remember_token'])]
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasFactory, Notifiable;

    protected static function booted(): void
    {
        static::creating(function (User $user) {
            do {
                $number = (string) random_int(1000000000, 9999999999);
            } while (self::where('internal_account_number', $number)->exists());
            $user->internal_account_number = $number;
        });
        static::updating(function (User $user) {
            if ($user->getOriginal('internal_account_number') && $user->isDirty('internal_account_number')) {
                throw new \LogicException('Internal account numbers cannot be changed.');
            }
        });
    }

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'is_admin' => 'boolean',
            'wallet_balance' => 'integer',
        ];
    }
}
