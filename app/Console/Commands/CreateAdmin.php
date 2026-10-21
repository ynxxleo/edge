<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules\Password;

class CreateAdmin extends Command
{
    protected $signature = 'edge:admin {email : Administrator email} {--name= : Display name} {--password= : Password; omit to enter it privately}';

    protected $description = 'Create an administrator or promote an existing account, using an explicitly supplied password';

    public function handle(): int
    {
        $email = Str::lower(trim((string) $this->argument('email')));
        $existing = User::where('email', $email)->first();
        $name = $this->option('name') ?: $existing?->name ?: $this->ask('Administrator name');
        $password = $this->option('password') ?: $this->secret('Password (at least 12 characters, letters and numbers)');
        $validator = Validator::make(compact('name', 'email', 'password'), [
            'name' => ['required', 'string', 'min:2', 'max:80'],
            'email' => ['required', 'email:rfc', 'max:254'],
            'password' => ['required', 'string', 'max:128', Password::min(12)->letters()->numbers()],
        ]);
        if ($validator->fails()) {
            foreach ($validator->errors()->all() as $error) {
                $this->error($error);
            }
            return self::FAILURE;
        }

        $user = $existing ?: new User;
        $user->name = $name;
        $user->email = $email;
        $user->password = $password;
        $user->is_admin = true;
        $user->save();
        $this->info("Administrator {$email} is ready. Sign in at /#admin.");

        return self::SUCCESS;
    }
}
