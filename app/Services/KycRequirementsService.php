<?php

namespace App\Services;

use App\Models\AdminAudit;
use App\Models\KycRequirementSetting;
use App\Models\KycUserRequirement;
use App\Models\User;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class KycRequirementsService
{
    private const SLUG = 'regex:/\A[a-z][a-z0-9_]{0,39}\z/D';
    private const TEXT = 'regex:/\A[^\x00-\x08\x0B\x0C\x0E-\x1F\x7F]*\z/u';

    public function settingsData(?KycRequirementSetting $settings = null): array
    {
        $settings ??= KycRequirementSetting::findOrFail(1);

        return ['version' => $settings->version, 'reason' => $settings->reason, 'layers' => $settings->layers ?? []];
    }

    public function forUser(User $user): array
    {
        $assignment = KycUserRequirement::where('user_id', $user->id)->first();

        return [
            'version' => $assignment?->version ?? 0,
            'reason' => $assignment?->reason ?? '',
            'layer_ids' => $assignment?->layer_ids ?? [],
            'layers' => $assignment?->layers ?? [],
        ];
    }

    public function updateSettings(User $admin, array $input): KycRequirementSetting
    {
        StakingRules::admin($admin);
        $this->allow($input, ['version', 'reason', 'layers']);
        $input = $this->trimText($input);
        $input = Validator::make($input, [
            'version' => ['required', 'integer', 'min:1'],
            'reason' => ['required', 'string', 'min:10', 'max:3000', self::TEXT],
            'layers' => ['present', 'array', 'max:8'],
            'layers.*' => ['required', 'array:id,name,reason,fields'],
            'layers.*.id' => ['required', 'string', self::SLUG, 'distinct'],
            'layers.*.name' => ['required', 'string', 'min:2', 'max:100', self::TEXT],
            'layers.*.reason' => ['present', 'nullable', 'string', 'max:1500', self::TEXT],
            'layers.*.fields' => ['required', 'array', 'min:1', 'max:12'],
            'layers.*.fields.*' => ['required', 'array:key,label,type,required,options'],
            'layers.*.fields.*.key' => ['required', 'string', self::SLUG],
            'layers.*.fields.*.label' => ['required', 'string', 'min:2', 'max:150', self::TEXT],
            'layers.*.fields.*.type' => ['required', Rule::in(['text', 'textarea', 'date', 'select', 'checkbox', 'file'])],
            'layers.*.fields.*.required' => ['required', 'boolean'],
            'layers.*.fields.*.options' => ['sometimes', 'array', 'max:30'],
            'layers.*.fields.*.options.*' => ['required', 'string', 'min:1', 'max:120', self::TEXT],
        ])->validate();
        $input['reason'] = trim($input['reason']);
        $input['layers'] = array_values($input['layers']);
        foreach ($input['layers'] as $index => &$layer) {
            $layer['name'] = trim($layer['name']);
            $layer['reason'] = trim($layer['reason'] ?? '');
            $layer['fields'] = array_values($layer['fields']);
            $seen = [];
            foreach ($layer['fields'] as $fieldIndex => &$field) {
                if (in_array($field['key'], $seen, true)) {
                    throw ValidationException::withMessages(["layers.$index.fields.$fieldIndex.key" => 'Field keys must be unique within a layer.']);
                }
                $seen[] = $field['key'];
                $field['label'] = trim($field['label']);
                $field['required'] = (bool) $field['required'];
                $field['options'] = array_values(array_map('trim', $field['options'] ?? []));
                if ($field['type'] === 'select' && (! count($field['options']) || count(array_unique($field['options'])) !== count($field['options']) || in_array('', $field['options'], true))) {
                    throw ValidationException::withMessages(["layers.$index.fields.$fieldIndex.options" => 'Select fields need distinct, nonempty options.']);
                }
                if ($field['type'] !== 'select' && count($field['options'])) {
                    throw ValidationException::withMessages(["layers.$index.fields.$fieldIndex.options" => 'Only select fields accept options.']);
                }
            }
            unset($field);
        }
        unset($layer);

        return StakingTransaction::run(function () use ($admin, $input): KycRequirementSetting {
            $settings = KycRequirementSetting::lockForUpdate()->findOrFail(1);
            abort_unless($settings->version === (int) $input['version'], 409, 'KYC form settings changed. Refresh before saving.');
            if ($settings->reason === $input['reason'] && $settings->layers === $input['layers']) {
                return $settings;
            }
            $before = $settings->version;
            $settings->fill(['version' => $before + 1, 'reason' => $input['reason'], 'layers' => $input['layers']])->save();
            $this->audit($admin, 'kyc.requirements_settings_updated', 'KycRequirementSetting', $settings->id, $before, $settings->version, count($input['layers']));

            return $settings;
        });
    }

    public function updateUser(User $user, User $admin, array $input): KycUserRequirement
    {
        StakingRules::admin($admin);
        $this->allow($input, ['version', 'layer_ids', 'reason']);
        $input = $this->trimText($input);
        $input = Validator::make($input, [
            'version' => ['required', 'integer', 'min:0'],
            'layer_ids' => ['present', 'array', 'max:8'],
            'layer_ids.*' => ['required', 'string', self::SLUG, 'distinct'],
            'reason' => ['present', 'nullable', 'string', 'max:3000', self::TEXT],
        ])->validate();
        $input['reason'] = trim($input['reason'] ?? '');

        return StakingTransaction::run(function () use ($user, $admin, $input): KycUserRequirement {
            User::lockForUpdate()->findOrFail($user->id);
            $assignment = KycUserRequirement::where('user_id', $user->id)->lockForUpdate()->first();
            $version = $assignment?->version ?? 0;
            abort_unless($version === (int) $input['version'], 409, 'This user’s KYC requirements changed. Refresh before saving.');
            $available = collect(KycRequirementSetting::findOrFail(1)->layers ?? [])->keyBy('id');
            $layers = [];
            foreach ($input['layer_ids'] as $id) {
                // A removed template can remain assigned until an administrator explicitly replaces it.
                $layer = $available->get($id) ?? collect($assignment?->layers ?? [])->firstWhere('id', $id);
                if (! $layer) {
                    throw ValidationException::withMessages(['layer_ids' => 'Choose only available KYC layers.']);
                }
                $layers[] = $layer;
            }
            $fileCount = collect($layers)->sum(fn (array $layer) => collect($layer['fields'])->where('type', 'file')->count());
            if ($fileCount > 18) {
                throw ValidationException::withMessages(['layer_ids' => 'Assign no more than 18 additional upload fields to one user.']);
            }
            $ids = array_values($input['layer_ids']);
            if (! $assignment && $layers === [] && $input['reason'] === '') {
                // Saving the untouched default does not revoke an existing base approval.
                return new KycUserRequirement(['user_id' => $user->id, 'version' => 0, 'layer_ids' => [], 'layers' => [], 'reason' => '']);
            }
            if ($assignment && $assignment->layers === $layers && $assignment->reason === $input['reason']) {
                return $assignment;
            }
            // Even clearing requirements gets a revision, preserving stale-form detection.
            $assignment ??= new KycUserRequirement(['user_id' => $user->id]);
            $assignment->fill([
                'version' => $version + 1, 'layer_ids' => $ids, 'layers' => $layers,
                'reason' => $input['reason'], 'assigned_by' => $admin->id,
            ])->save();
            $this->audit($admin, 'kyc.user_requirements_updated', 'User', $user->id, $version, $assignment->version, count($layers));

            return $assignment;
        });
    }

    private function allow(array $input, array $keys): void
    {
        $unknown = array_diff(array_keys($input), $keys);
        if ($unknown) {
            throw ValidationException::withMessages(array_fill_keys($unknown, ['This field is not accepted.']));
        }
    }

    private function trimText(array $input): array
    {
        foreach ($input as $key => $value) {
            if (is_array($value)) {
                $input[$key] = $this->trimText($value);
            } elseif (is_string($value) && ! in_array($key, ['id', 'key', 'type'], true)) {
                $input[$key] = trim($value);
            }
        }

        return $input;
    }

    private function audit(User $admin, string $action, string $subject, int $id, int $before, int $after, int $count): void
    {
        AdminAudit::create([
            'actor_id' => $admin->id, 'action' => $action, 'subject_type' => $subject, 'subject_id' => $id,
            'before' => ['version' => $before], 'after' => ['version' => $after, 'layer_count' => $count],
        ]);
    }
}
