<?php

namespace App\Services;

use App\Models\AdminAudit;
use App\Models\ManualPaymentMethod;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class ManualPaymentMethodService
{
    public function save(User $admin, array $definition, string $password, ?UploadedFile $image, ?ManualPaymentMethod $method = null): ManualPaymentMethod
    {
        $rules = [
            'name' => ['required', 'string', 'max:80', 'regex:/\A[^\p{C}]+\z/u'],
            'instructions' => ['required', 'string', 'max:3000'],
            'enabled' => ['required', 'boolean'], 'deposit_enabled' => ['required', 'boolean'], 'withdrawal_enabled' => ['required', 'boolean'],
            'version' => [$method ? 'required' : 'prohibited', 'integer', 'min:1'],
            'fields' => ['present', 'array', 'max:12'],
            'fields.*' => ['required', 'array:key,label,type,required,options,hint'],
            'fields.*.key' => ['required', 'string', 'regex:/\Af_[a-z0-9_]{1,40}\z/D', 'distinct'],
            'fields.*.label' => ['required', 'string', 'max:80', 'regex:/\A[^\p{C}]+\z/u'],
            'fields.*.type' => ['required', Rule::in(['text', 'textarea', 'email', 'select'])],
            'fields.*.required' => ['required', 'boolean'],
            'fields.*.hint' => ['present', 'nullable', 'string', 'max:160'],
            'fields.*.options' => ['present', 'array', 'max:20'],
            'fields.*.options.*' => ['required', 'string', 'max:80'],
        ];
        $unknown = array_diff(array_keys($definition), array_keys(array_filter($rules, fn ($key) => ! str_contains($key, '.'), ARRAY_FILTER_USE_KEY)));
        if ($unknown) {
            throw ValidationException::withMessages(array_fill_keys($unknown, 'This field is not accepted.'));
        }
        $data = Validator::make($definition, $rules)->validate();
        $data['fields'] = array_map(function (array $field): array {
            $field['required'] = (bool) $field['required'];
            return $field;
        }, $data['fields']);
        if (! array_is_list($data['fields'])) {
            StakingRules::fail('fields', 'Provide a list of withdrawal fields.');
        }
        if (! $data['deposit_enabled'] && ! $data['withdrawal_enabled']) {
            StakingRules::fail('deposit_enabled', 'Choose deposits, withdrawals, or both.');
        }
        if ($data['withdrawal_enabled'] && count($data['fields']) === 0) {
            StakingRules::fail('fields', 'Add at least one field for the user’s withdrawal details.');
        }
        foreach ($data['fields'] as $index => $field) {
            if (! array_is_list($field['options']) || count(array_unique($field['options'])) !== count($field['options']) || ($field['type'] === 'select' && count($field['options']) < 2) || ($field['type'] !== 'select' && count($field['options']) > 0)) {
                StakingRules::fail('fields.'.$index.'.options', 'Dropdowns need 2–20 unique choices. Other field types do not accept choices.');
            }
        }
        Validator::make(['image' => $image], ['image' => [$method ? 'nullable' : 'required', 'file', 'image', 'mimes:jpg,jpeg,png,webp', 'max:1024', 'dimensions:max_width=2400,max_height=2400']])->validate();

        return StakingTransaction::run(function () use ($admin, $data, $password, $image, $method): ManualPaymentMethod {
            $actor = User::lockForUpdate()->findOrFail($admin->id);
            StakingRules::admin($actor);
            if (! Hash::check($password, $actor->getAuthPassword())) {
                StakingRules::fail('current_password', 'Your current administrator password is incorrect.');
            }
            $record = $method ? ManualPaymentMethod::lockForUpdate()->findOrFail($method->id) : new ManualPaymentMethod;
            if ($method) {
                abort_unless($record->version === (int) $data['version'], 409, 'This payment method changed. Refresh before saving.');
            } elseif (ManualPaymentMethod::count() >= 50) {
                StakingRules::fail('name', 'A maximum of 50 payment methods is supported. Edit or disable an existing method.');
            }
            $previous = $record->exists ? $record->version : null;
            $values = $data;
            unset($values['version']);
            $values['name'] = trim($values['name']);
            $values['instructions'] = trim($values['instructions']);
            if ($values['name'] === '' || $values['instructions'] === '') {
                StakingRules::fail('name', 'Enter a name and payment instructions.');
            }
            $record->fill($values);
            $record->version = ($previous ?? 0) + 1;
            $record->updated_by = $actor->id;
            if ($image) {
                $record->image_data = base64_encode(file_get_contents($image->getRealPath()));
                $record->image_mime = $image->getMimeType();
            }
            $record->save();
            AdminAudit::create(['actor_id' => $actor->id, 'action' => $previous ? 'manual_method.updated' : 'manual_method.created',
                'subject_type' => 'ManualPaymentMethod', 'subject_id' => $record->id,
                'before' => $previous ? ['version' => $previous] : null,
                'after' => ['version' => $record->version, 'enabled' => $record->enabled, 'deposit_enabled' => $record->deposit_enabled, 'withdrawal_enabled' => $record->withdrawal_enabled]]);
            return $record;
        });
    }

    public function data(ManualPaymentMethod $method): array
    {
        return ['id' => $method->id, 'version' => $method->version, 'name' => $method->name,
            'instructions' => $method->instructions, 'fields' => $method->fields,
            'enabled' => $method->enabled, 'deposit_enabled' => $method->deposit_enabled, 'withdrawal_enabled' => $method->withdrawal_enabled,
            'image_url' => '/api/manual-payment-methods/'.$method->id.'/image?v='.$method->version];
    }

    /** Called while reserving the wallet request; lock and snapshot the chosen definition. */
    public function requestDetails(string $method, string $type, array $details): array
    {
        $record = ManualPaymentMethod::lockForUpdate()->find((int) substr($method, 7));
        if (! $record || ! $record->enabled || ! $record->{$type.'_enabled'}) {
            StakingRules::fail('method', 'This payment method is not available for this request.');
        }
        abort_unless((int) ($details['method_version'] ?? 0) === $record->version, 409, 'The payment instructions changed. Reopen the payment form before submitting.');
        $allowed = $type === 'withdrawal' ? ['method_version', 'answers', 'note'] : ['method_version', 'reference', 'note'];
        if (array_diff(array_keys($details), $allowed)) {
            StakingRules::fail('details', 'Unexpected payment details. Reopen the payment form.');
        }
        $answers = $details['answers'] ?? [];
        if (! is_array($answers)) {
            StakingRules::fail('details.answers', 'Provide your withdrawal details.');
        }
        $fields = $type === 'withdrawal' ? $record->fields : [];
        if (array_diff(array_keys($answers), array_column($fields, 'key'))) {
            StakingRules::fail('details.answers', 'Only the payment method’s configured fields are accepted.');
        }
        $rules = [];
        foreach ($fields as $field) {
            $rules[$field['key']] = [$field['required'] ? 'required' : 'nullable', 'string', 'max:'.($field['type'] === 'textarea' ? 1500 : 500)];
            if ($field['type'] === 'email') $rules[$field['key']][] = 'email:rfc';
            if ($field['type'] === 'select') $rules[$field['key']][] = Rule::in($field['options']);
        }
        $validator = Validator::make($answers, $rules);
        if ($validator->fails()) {
            $errors = [];
            foreach ($validator->errors()->messages() as $key => $messages) {
                $label = collect($fields)->firstWhere('key', $key)['label'] ?? $key;
                $errors['details.answers.'.$key] = [str_replace(str_replace('_', ' ', $key), $label, $messages[0])];
            }
            throw ValidationException::withMessages($errors);
        }
        $answers = $validator->validated();
        if ($type === 'deposit') {
            Validator::make($details, ['reference' => ['required', 'string', 'max:160'], 'note' => ['nullable', 'string', 'max:500']])->validate();
        }
        return array_filter(['reference' => $details['reference'] ?? null, 'note' => $details['note'] ?? null,
            'answers' => $answers, 'manual_payment_method' => ['id' => $record->id, 'version' => $record->version,
                'name' => $record->name, 'instructions' => $record->instructions, 'fields' => $fields]], fn ($value) => $value !== null);
    }
}
