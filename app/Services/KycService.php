<?php

namespace App\Services;

use App\Models\AdminAudit;
use App\Models\KycSubmission;
use App\Models\KycRequirementSetting;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class KycService
{
    // ISO 3166-1 alpha-2 codes, rather than any arbitrary two-letter input.
    private const COUNTRIES = 'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW';

    public static function rules(): array
    {
        $text = 'regex:/\A[^\x00-\x08\x0B\x0C\x0E-\x1F\x7F]*\z/u';
        $maxFile = (int) config('kyc.max_file_kilobytes', 2048);

        return [
            'legal_name' => ['required', 'string', 'min:2', 'max:160', $text],
            'date_of_birth' => ['required', 'date_format:Y-m-d', 'after_or_equal:1900-01-01', 'before_or_equal:'.CarbonImmutable::today(config('app.timezone'))->subYears(18)->toDateString()],
            'country' => ['required', 'string', Rule::in(explode(' ', self::COUNTRIES))],
            'address' => ['required', 'string', 'min:10', 'max:1000', $text],
            'document_type' => ['required', Rule::in(['passport', 'national_id', 'drivers_license'])],
            'document_number' => ['required', 'string', 'min:3', 'max:80', $text],
            'id_document' => ['required', 'file', 'mimes:jpg,jpeg,png,pdf', 'mimetypes:image/jpeg,image/png,application/pdf', 'max:'.$maxFile],
            'selfie' => ['required', 'file', 'mimes:jpg,jpeg,png', 'mimetypes:image/jpeg,image/png', 'max:'.$maxFile],
            'consent' => ['required', 'accepted'],
            'requirements_version' => ['sometimes', 'integer', 'min:0'],
            'answers' => ['sometimes', 'array'],
        ];
    }

    public static function normalize(array $input): array
    {
        foreach (['legal_name', 'date_of_birth', 'country', 'address', 'document_type', 'document_number'] as $key) {
            if (isset($input[$key]) && is_string($input[$key])) {
                $input[$key] = trim($input[$key]);
            }
        }
        if (isset($input['country']) && is_string($input['country'])) {
            $input['country'] = strtoupper($input['country']);
        }

        return $input;
    }

    public function latest(User $user): ?KycSubmission
    {
        return KycSubmission::where('user_id', $user->id)->latest('id')->first();
    }

    public function summary(User $user, ?KycSubmission $submission = null): array
    {
        $submission ??= $this->latest($user);
        $requirements = app(KycRequirementsService::class)->forUser($user);
        $changed = $submission && (int) $submission->requirements_version !== $requirements['version'];

        return [
            'status' => $changed ? 'additional_required' : ($submission?->status ?? 'not_submitted'),
            'submission_id' => $submission?->id,
            'version' => $submission?->version,
            'submitted_at' => $submission?->created_at?->toIso8601String(),
            'reviewed_at' => $submission?->reviewed_at?->toIso8601String(),
            'review_note' => $submission?->review_note,
            'withdrawal_requires_approval' => (bool) config('kyc.withdrawal_requires_approval', true),
            'reason' => KycRequirementSetting::findOrFail(1)->reason,
            'requirements' => $requirements,
            'requirements_changed' => (bool) $changed,
        ];
    }

    public function assertWithdrawalApproved(User $user): void
    {
        if (config('kyc.withdrawal_requires_approval', true) && $this->summary($user)['status'] !== 'approved') {
            StakingRules::fail('kyc', 'Complete identity verification and receive administrator approval before withdrawing.');
        }
    }

    public function submit(User $user, array $input): KycSubmission
    {
        $input = self::normalize($input);
        $unknown = array_diff(array_keys($input), array_keys(self::rules()));
        if ($unknown) {
            throw ValidationException::withMessages(array_fill_keys($unknown, ['This field is not accepted.']));
        }
        $input = Validator::make($input, self::rules())->validate();
        $requirements = app(KycRequirementsService::class)->forUser($user);
        abort_unless((int) ($input['requirements_version'] ?? 0) === $requirements['version'], 409, 'Your KYC requirements changed. Refresh the verification form before submitting.');
        $answers = $this->validateAnswers($input['answers'] ?? [], $requirements['layers']);

        $uploads = ['id_document' => $input['id_document'], 'selfie' => $input['selfie']];
        foreach ($requirements['layers'] as $layer) {
            foreach ($layer['fields'] as $field) {
                if ($field['type'] === 'file' && ($upload = $answers[$layer['id']][$field['key']] ?? null) instanceof UploadedFile) {
                    $kind = 'layer_'.hash('sha256', $layer['id'].'.'.$field['key']);
                    $uploads[$kind] = $upload;
                    $answers[$layer['id']][$field['key']] = ['document_kind' => $kind];
                }
            }
        }
        if (array_sum(array_map(fn (UploadedFile $file) => $file->getSize(), $uploads)) > (int) config('kyc.max_total_file_kilobytes', 6144) * 1024) {
            throw ValidationException::withMessages(['answers' => 'The combined verification uploads must be 6 MB or smaller.']);
        }

        $disk = Storage::disk(config('kyc.disk', 'kyc'));
        $written = [];
        try {
            // Only ciphertext is written to application storage; PHP owns the request-scoped upload temporaries.
            $folder = (string) Str::uuid();
            $documents = [];
            foreach ($uploads as $kind => $upload) {
                /** @var UploadedFile $upload */
                $path = $folder.'/'.$kind.'.enc';
                $contents = file_get_contents($upload->getRealPath());
                if ($contents === false) {
                    throw new \RuntimeException('Verification upload could not be read.');
                }
                $written[] = $path;
                if (! $disk->put($path, Crypt::encryptString($contents), ['visibility' => 'private'])) {
                    throw new \RuntimeException('Verification upload could not be stored.');
                }
                $documents[$kind] = [
                    'path' => $path,
                    'mime_type' => $upload->getMimeType(),
                    'size' => strlen($contents),
                    'sha256' => hash('sha256', $contents),
                ];
                unset($contents);
            }

            return StakingTransaction::run(function () use ($user, $input, $documents, $requirements, $answers): KycSubmission {
                User::lockForUpdate()->findOrFail($user->id);
                $current = app(KycRequirementsService::class)->forUser($user);
                abort_unless($current['version'] === $requirements['version'], 409, 'Your KYC requirements changed. Refresh the verification form before submitting.');
                $latest = $this->latest($user);
                abort_if($latest && (int) $latest->requirements_version === $requirements['version'] && in_array($latest->status, ['pending', 'approved'], true), 409, 'Your current verification is pending or already approved.');
                $submission = KycSubmission::create([
                    'user_id' => $user->id, 'status' => 'pending', 'version' => 1,
                    ...collect($input)->only('legal_name', 'date_of_birth', 'country', 'address', 'document_type', 'document_number')->all(),
                    'documents' => $documents, 'consented_at' => now(),
                    'requirements_version' => $requirements['version'],
                    'requirements_snapshot' => [...$requirements, 'global_reason' => KycRequirementSetting::findOrFail(1)->reason],
                    'answers' => $answers,
                ]);
                $this->audit($user, 'kyc.submitted', $submission, null);

                return $submission;
            });
        } catch (\Throwable $error) {
            // Validation happens before uploads; transaction rejection must not leave orphaned documents.
            foreach ($written as $path) {
                try {
                    $disk->delete($path);
                } catch (\Throwable) {
                    // Preserve the original error without disclosing private document paths.
                }
            }
            throw $error;
        }
    }

    public function listData(KycSubmission $submission): array
    {
        $submission->loadMissing('user');

        return [
            'id' => $submission->id, 'status' => $submission->status, 'version' => $submission->version,
            'user' => ['id' => $submission->user->id, 'name' => $submission->user->name, 'email' => $submission->user->email],
            'submitted_at' => $submission->created_at?->toIso8601String(),
            'reviewed_at' => $submission->reviewed_at?->toIso8601String(),
            'requirements_version' => (int) $submission->requirements_version,
            'requirements_changed' => (int) $submission->requirements_version !== app(KycRequirementsService::class)->forUser($submission->user)['version'],
        ];
    }

    public function detailData(KycSubmission $submission): array
    {
        $data = $this->listData($submission);
        foreach (['legal_name', 'date_of_birth', 'country', 'address', 'document_type', 'document_number', 'review_note'] as $field) {
            $data[$field] = $submission->$field;
        }
        $data['consented_at'] = $submission->consented_at?->toIso8601String();
        $data['requirements'] = $submission->requirements_snapshot ?? ['version' => 0, 'reason' => '', 'layer_ids' => [], 'layers' => []];
        $data['answers'] = $submission->answers ?? [];
        $data['documents'] = [];
        foreach ($submission->documents ?? [] as $kind => $document) {
            if ($this->validDocumentKind($kind)) {
                $data['documents'][$kind] = [
                    'download_url' => '/api/kyc/'.$submission->id.'/documents/'.$kind,
                    'mime_type' => $document['mime_type'], 'size' => $document['size'],
                ];
            }
        }

        return $data;
    }

    public function review(KycSubmission $submission, User $admin, array $input): KycSubmission
    {
        StakingRules::admin($admin);
        abort_if((int) $submission->user_id === (int) $admin->id, 403, 'Administrators cannot review their own identity verification.');
        $unknown = array_diff(array_keys($input), ['version', 'decision', 'review_note']);
        if ($unknown) {
            throw ValidationException::withMessages(array_fill_keys($unknown, ['This field is not accepted.']));
        }
        $input['review_note'] = isset($input['review_note']) && is_string($input['review_note']) ? trim($input['review_note']) : ($input['review_note'] ?? null);
        $input = Validator::make($input, [
            'version' => ['required', 'integer', 'min:1'],
            'decision' => ['required', Rule::in(['approved', 'rejected'])],
            'review_note' => ['required_if:decision,rejected', 'nullable', 'string', 'min:10', 'max:1500'],
        ])->validate();
        $note = filled($input['review_note'] ?? null) ? $input['review_note'] : null;

        return StakingTransaction::run(function () use ($submission, $admin, $input, $note): KycSubmission {
            // Lock in the same order as withdrawals and new submissions.
            User::lockForUpdate()->findOrFail($submission->user_id);
            $submission = KycSubmission::lockForUpdate()->findOrFail($submission->id);
            abort_unless((int) $submission->requirements_version === app(KycRequirementsService::class)->forUser($submission->user)['version'], 409, 'This user’s KYC requirements changed. Review a new submission for the current requirements.');
            if ($submission->status !== 'pending') {
                if ($submission->status === $input['decision'] && $submission->review_note === $note) {
                    return $submission;
                }
                abort(409, 'This identity verification has already received a final review.');
            }
            abort_unless($submission->version === (int) $input['version'], 409, 'Verification changed. Refresh it before reviewing.');
            abort_unless($this->latest($submission->user)?->id === $submission->id, 409, 'Only the latest verification submission can be reviewed.');
            $before = ['status' => $submission->status, 'version' => $submission->version];
            $submission->fill([
                'status' => $input['decision'], 'version' => $submission->version + 1,
                'review_note' => $note, 'reviewed_by' => $admin->id, 'reviewed_at' => now(),
            ])->save();
            $this->audit($admin, 'kyc.'.$submission->status, $submission, $before);

            return $submission;
        });
    }

    /** Authorize before looking up any file metadata or touching private storage. */
    public function document(KycSubmission $submission, User $viewer, string $kind): array
    {
        abort_unless((int) $submission->user_id === (int) $viewer->id || $viewer->is_admin, 404);
        abort_unless($this->validDocumentKind($kind), 404);
        $document = ($submission->documents ?? [])[$kind] ?? null;
        abort_unless($document, 404);
        $disk = Storage::disk(config('kyc.disk', 'kyc'));
        abort_unless($disk->exists($document['path']), 404);
        $contents = Crypt::decryptString($disk->get($document['path']));
        abort_unless(hash_equals($document['sha256'], hash('sha256', $contents)), 500, 'This verification document could not be read.');

        return ['contents' => $contents, 'mime_type' => $document['mime_type']];
    }

    private function validDocumentKind(string $kind): bool
    {
        return in_array($kind, ['id_document', 'selfie'], true) || preg_match('/\Alayer_[a-f0-9]{64}\z/D', $kind) === 1;
    }

    private function validateAnswers(array $answers, array $layers): array
    {
        $layerIds = array_column($layers, 'id');
        if (array_diff(array_keys($answers), $layerIds)) {
            throw ValidationException::withMessages(['answers' => 'An unassigned verification layer was submitted.']);
        }
        $rules = ['answers' => ['array']];
        foreach ($layers as $layer) {
            $id = $layer['id'];
            if (array_key_exists($id, $answers) && (! is_array($answers[$id]) || array_diff(array_keys($answers[$id]), array_column($layer['fields'], 'key')))) {
                throw ValidationException::withMessages(["answers.$id" => 'Only the assigned verification fields are accepted.']);
            }
            $rules["answers.$id"] = ['sometimes', 'array'];
            foreach ($layer['fields'] as $field) {
                $name = "answers.$id.".$field['key'];
                $required = $field['required'] ? 'required' : 'nullable';
                $rules[$name] = match ($field['type']) {
                    'text' => [$required, 'string', 'max:500', 'regex:/\A[^\x00-\x08\x0B\x0C\x0E-\x1F\x7F]*\z/u'],
                    'textarea' => [$required, 'string', 'max:3000', 'regex:/\A[^\x00-\x08\x0B\x0C\x0E-\x1F\x7F]*\z/u'],
                    'date' => [$required, 'date_format:Y-m-d'],
                    'select' => [$required, 'string', Rule::in($field['options'])],
                    'checkbox' => $field['required'] ? ['required', 'accepted'] : ['nullable', 'boolean'],
                    'file' => [$required, 'file', 'mimes:jpg,jpeg,png,pdf', 'mimetypes:image/jpeg,image/png,application/pdf', 'max:'.(int) config('kyc.max_file_kilobytes', 2048)],
                };
            }
        }
        $validated = Validator::make(['answers' => $answers], $rules)->validate()['answers'];
        foreach ($layers as $layer) {
            foreach ($layer['fields'] as $field) {
                if ($field['type'] === 'checkbox' && array_key_exists($field['key'], $validated[$layer['id']] ?? [])) {
                    $validated[$layer['id']][$field['key']] = in_array($validated[$layer['id']][$field['key']], [true, 1, '1', 'yes', 'on', 'true'], true);
                }
            }
        }

        return $validated;
    }

    private function audit(User $actor, string $action, KycSubmission $submission, ?array $before): void
    {
        // Never copy identity fields, upload metadata or review notes into the general audit feed.
        AdminAudit::create([
            'actor_id' => $actor->id, 'action' => $action,
            'subject_type' => 'KycSubmission', 'subject_id' => $submission->id,
            'before' => $before,
            'after' => ['status' => $submission->status, 'version' => $submission->version],
        ]);
    }
}
