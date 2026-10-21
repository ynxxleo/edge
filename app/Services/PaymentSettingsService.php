<?php

namespace App\Services;

use App\Models\AdminAudit;
use App\Models\PaymentSetting;
use App\Models\User;
use Illuminate\Support\Facades\Hash;

class PaymentSettingsService
{
    public function current(): PaymentSetting
    {
        return PaymentSetting::findOrFail(1);
    }

    public function publicMethods(?PaymentSetting $settings = null): array
    {
        $settings ??= $this->current();
        return [
            'currency' => StakingCurrency::code(),
            'manual_catalog_configured' => \App\Models\ManualPaymentMethod::exists(),
            'manual_methods' => \App\Models\ManualPaymentMethod::select('id', 'name', 'instructions', 'fields', 'enabled', 'deposit_enabled', 'withdrawal_enabled', 'version')->where('enabled', true)->orderBy('id')->get()->map(app(ManualPaymentMethodService::class)->data(...))->all(),
            'stripe' => [
                'enabled' => $settings->stripe_enabled && filled($settings->stripe_publishable_key) && filled($settings->stripe_secret_key) && filled($settings->stripe_webhook_secret),
                'mode' => $settings->stripe_mode,
                'publishable_key' => $settings->stripe_enabled ? $settings->stripe_publishable_key : null,
            ],
            'manual' => [
                'enabled' => $settings->manual_enabled,
                'bank_name' => $settings->manual_bank_name ?? '', 'account_name' => $settings->manual_account_name ?? '',
                'account_number' => $settings->manual_account_number ?? '',
                'instructions' => $settings->manual_instructions ?: config('staking.deposit_instructions'),
                'reference_label' => $settings->manual_reference_label ?: 'Transfer reference',
                'support_contact' => $settings->manual_support_contact ?? '',
            ],
        ];
    }

    public function adminData(?PaymentSetting $settings = null): array
    {
        $settings ??= $this->current();
        $public = $this->publicMethods($settings);
        return [
            'settings' => [
                'version' => $settings->version, 'stripe_enabled' => $settings->stripe_enabled,
                'stripe_mode' => $settings->stripe_mode, 'stripe_publishable_key' => $settings->stripe_publishable_key ?? '',
                'stripe_secret_key_configured' => filled($settings->stripe_secret_key),
                'stripe_secret_key_last4' => filled($settings->stripe_secret_key) ? substr($settings->stripe_secret_key, -4) : null,
                'stripe_webhook_secret_configured' => filled($settings->stripe_webhook_secret),
                'stripe_webhook_secret_last4' => filled($settings->stripe_webhook_secret) ? substr($settings->stripe_webhook_secret, -4) : null,
                'manual_enabled' => $settings->manual_enabled,
                'manual_bank_name' => $public['manual']['bank_name'], 'manual_account_name' => $public['manual']['account_name'],
                'manual_account_number' => $public['manual']['account_number'], 'manual_instructions' => $public['manual']['instructions'],
                'manual_reference_label' => $public['manual']['reference_label'], 'manual_support_contact' => $public['manual']['support_contact'],
                'updated_at' => $settings->updated_at?->toIso8601String(),
            ],
            'webhook_url' => rtrim(config('app.url'), '/').'/api/payments/stripe/webhook',
        ];
    }

    public function update(User $admin, array $input): PaymentSetting
    {
        StakingRules::admin($admin);
        if (! Hash::check($input['current_password'] ?? '', $admin->getAuthPassword())) {
            StakingRules::fail('current_password', 'Your current administrator password is incorrect.');
        }
        return StakingTransaction::run(function () use ($admin, $input): PaymentSetting {
            $settings = PaymentSetting::lockForUpdate()->findOrFail(1);
            abort_unless($settings->version === (int) $input['version'], 409, 'Payment settings changed. Refresh them before saving.');
            $beforeVersion = $settings->version;
            unset($input['current_password'], $input['version']);
            foreach (['stripe_secret_key', 'stripe_webhook_secret'] as $field) {
                if (blank($input[$field] ?? null)) {
                    unset($input[$field]);
                }
            }
            $oldWebhook = $settings->stripe_webhook_secret;
            $settings->fill($input);
            $mode = $settings->stripe_mode;
            if (app()->environment('production') && $settings->stripe_enabled && $mode !== 'live') {
                StakingRules::fail('stripe_mode', 'Stripe test payments cannot fund production wallets. Configure live mode before enabling Stripe.');
            }
            foreach (['stripe_publishable_key' => 'pk_', 'stripe_secret_key' => 'sk_'] as $field => $prefix) {
                if (filled($settings->$field) && ! preg_match('/^'.$prefix.$mode.'_[A-Za-z0-9]{8,}$/D', $settings->$field)) {
                    StakingRules::fail($field, 'Use a valid Stripe '.$mode.' mode key. Both API keys must match the selected mode.');
                }
            }
            if (filled($settings->stripe_webhook_secret) && ! preg_match('/^whsec_[A-Za-z0-9]{8,}$/D', $settings->stripe_webhook_secret)) {
                StakingRules::fail('stripe_webhook_secret', 'Enter the Stripe webhook signing secret beginning with whsec_.');
            }
            if ($settings->stripe_enabled && (blank($settings->stripe_publishable_key) || blank($settings->stripe_secret_key) || blank($settings->stripe_webhook_secret))) {
                StakingRules::fail('stripe_enabled', 'Configure the publishable key, secret key and webhook signing secret before enabling Stripe.');
            }
            $manualTouched = count(array_filter(array_keys($input), fn ($field) => str_starts_with($field, 'manual_'))) > 0;
            if ($settings->manual_enabled && $manualTouched) {
                foreach (['manual_bank_name', 'manual_account_name', 'manual_account_number'] as $field) {
                    if (blank($settings->$field)) {
                        StakingRules::fail($field, 'Enter verified bank details before enabling manual deposits.');
                    }
                }
            }
            $changed = array_keys($settings->getDirty());
            // Preserve old endpoint signing keys for in-flight sessions during a 24-hour rollover.
            if (filled($oldWebhook) && $oldWebhook !== $settings->stripe_webhook_secret) {
                $previous = array_values(array_filter($settings->previous_webhook_secrets ?? [], fn ($item) => ($item['expires_at'] ?? 0) >= now()->timestamp));
                $previous[] = ['secret' => $oldWebhook, 'expires_at' => now()->addHours(24)->timestamp];
                $settings->previous_webhook_secrets = $previous;
            }
            $settings->version++;
            $settings->save();
            AdminAudit::create([
                'actor_id' => $admin->id, 'action' => 'payment_settings.updated',
                'subject_type' => 'PaymentSetting', 'subject_id' => 1,
                'before' => ['version' => $beforeVersion],
                'after' => ['version' => $settings->version, 'changed_fields' => $changed],
            ]);
            return $settings;
        });
    }
}
