<?php

/** Configurable KYC integration checks in a disposable database and private upload directory. */
require __DIR__.'/../vendor/autoload.php';

use App\Models\AdminAudit;
use App\Models\KycSubmission;
use App\Models\User;
use App\Models\WalletRequest;
use App\Models\WalletTransaction;
use App\Services\KycRequirementsService;
use App\Services\KycService;
use App\Services\WalletRequestService;
use App\Services\WalletService;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

$directory = sys_get_temp_dir().'/edge-kyc-layers-'.bin2hex(random_bytes(8));
mkdir($directory, 0700);
$database = $directory.'/checks.sqlite';
touch($database);

try {
    $app = require __DIR__.'/../bootstrap/app.php';
    $app->make(Kernel::class)->bootstrap();
    $app['env'] = 'testing';
    config([
        'database.default' => 'sqlite',
        'database.connections.sqlite.database' => $database,
        'database.connections.sqlite.transaction_mode' => 'IMMEDIATE',
        'database.connections.sqlite.busy_timeout' => 5000,
        'cache.default' => 'array',
        'filesystems.disks.kyc.root' => $directory.'/private-documents',
        'kyc.withdrawal_requires_approval' => true,
    ]);
    DB::purge('sqlite');
    Storage::forgetDisk('kyc');
    Http::preventStrayRequests();
    Artisan::call('migrate', ['--force' => true]);
    CarbonImmutable::setTestNow(CarbonImmutable::parse('2030-03-20 12:00:00', 'UTC'));

    $count = 0;
    $check = function (bool $condition, string $message) use (&$count): void {
        if (! $condition) {
            throw new RuntimeException('FAILED: '.$message);
        }
        $count++;
    };
    $reject = function (callable $action, int $status, string $message, ?string $field = null) use ($check): void {
        try {
            $action();
        } catch (ValidationException $error) {
            $check($status === 422, $message.' (validation status)');
            if ($field !== null) {
                $check(array_key_exists($field, $error->errors()), $message.' (field '.$field.')');
            }
            return;
        } catch (HttpExceptionInterface $error) {
            $check($error->getStatusCode() === $status, $message.' (HTTP '.$error->getStatusCode().')');
            return;
        }
        $check(false, $message.' (accepted unexpectedly)');
    };
    $user = function (string $name, bool $admin = false): User {
        $user = User::create(['name' => $name, 'email' => strtolower(str_replace(' ', '-', $name)).'@layers.test.invalid', 'password' => 'SyntheticLayerPassword123']);
        if ($admin) {
            $user->is_admin = true;
            $user->save();
        }
        return $user;
    };
    $admin = $user('Layers Administrator', true);
    $member = $user('Layers Member');
    $other = $user('Unassigned Member');
    $pendingMember = $user('Pending Member');
    $requirements = app(KycRequirementsService::class);
    $kyc = app(KycService::class);
    $wallet = app(WalletService::class);
    $requests = app(WalletRequestService::class);
    $image = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2MwAAAABJRU5ErkJggg==');
    $upload = function (string $name = 'synthetic.png', ?string $contents = null) use ($directory, $image): UploadedFile {
        $path = tempnam($directory, 'request-upload-');
        file_put_contents($path, $contents ?? $image);
        chmod($path, 0600);
        // Real UploadedFile inspection checks bytes rather than trusting a fake file's extension.
        return new UploadedFile($path, $name, null, UPLOAD_ERR_OK, true);
    };
    $baseInput = fn (): array => [
        'legal_name' => 'Synthetic Layer Person', 'date_of_birth' => '1992-03-04', 'country' => 'US',
        'address' => '123 Synthetic Verification Street, Test City', 'document_type' => 'passport',
        'document_number' => 'SYNTHETIC-LAYER-0001', 'consent' => '1',
        'id_document' => $upload('synthetic-id.png'), 'selfie' => $upload('synthetic-selfie.png'),
    ];
    $approve = fn (KycSubmission $submission): KycSubmission => $kyc->review($submission, $admin, ['version' => $submission->version, 'decision' => 'approved']);
    $files = fn (): array => Storage::disk('kyc')->allFiles();

    $settings = $requirements->settingsData();
    $check($settings['version'] === 1 && $settings['layers'] === [], 'migration installs an empty versioned layer catalogue');
    $check(is_string($settings['reason']) && strlen($settings['reason']) > 20, 'new installations have a customer-facing verification explanation');
    $initial = $requirements->forUser($member);
    $check($initial['version'] === 0 && $initial['layers'] === [], 'unassigned customers retain base verification without added requirements');
    $check($kyc->summary($member)['status'] === 'not_submitted', 'unassigned unverified status remains compatible with existing customers');

    // Prove that an existing approval remains immutable when new requirements are assigned.
    $original = $approve($kyc->submit($member, $baseInput()));
    $originalRaw = DB::table('kyc_submissions')->where('id', $original->id)->first();
    $kyc->assertWithdrawalApproved($member);
    $check($original->status === 'approved', 'a base-only verification can still receive administrator approval');
    $pendingOriginal = $kyc->submit($pendingMember, $baseInput());

    $layer = [
        'id' => 'enhanced', 'name' => 'Enhanced verification',
        'reason' => 'Provide the details below so our review team can check your account.',
        'fields' => [
            ['key' => 'occupation', 'label' => 'Occupation', 'type' => 'text', 'required' => true],
            ['key' => 'funds_explanation', 'label' => 'Source of funds', 'type' => 'textarea', 'required' => true],
            ['key' => 'statement_date', 'label' => 'Statement date', 'type' => 'date', 'required' => true],
            ['key' => 'funds_source', 'label' => 'Primary funds source', 'type' => 'select', 'required' => true, 'options' => ['Employment', 'Savings', 'Business']],
            ['key' => 'declaration', 'label' => 'The supplied information is accurate', 'type' => 'checkbox', 'required' => true],
            ['key' => 'supporting_document', 'label' => 'Supporting document', 'type' => 'file', 'required' => true],
            ['key' => 'reference', 'label' => 'Optional reference', 'type' => 'text', 'required' => false],
        ],
    ];
    $secondLayer = [
        'id' => 'residency', 'name' => 'Residency review',
        'reason' => 'Confirm the country where you currently reside.',
        'fields' => [
            ['key' => 'residence', 'label' => 'Country of residence', 'type' => 'text', 'required' => true],
            ['key' => 'contact_consent', 'label' => 'Optional contact consent', 'type' => 'checkbox', 'required' => false],
            ['key' => 'additional_document', 'label' => 'Optional residency document', 'type' => 'file', 'required' => false],
        ],
    ];
    $catalogue = ['version' => 1, 'reason' => 'We request identity details to protect accounts and review withdrawal eligibility.', 'layers' => [$layer, $secondLayer]];
    $reject(fn () => $requirements->updateSettings($member, $catalogue), 403, 'only administrators may edit verification requirements');
    $requirements->updateSettings($admin, $catalogue);
    $settings = $requirements->settingsData();
    $check($settings['version'] === 2 && count($settings['layers']) === 2, 'administrator creates multiple reusable verification layers');

    $reject(fn () => $requirements->updateSettings($admin, $catalogue), 409, 'stale settings revisions cannot overwrite a newer catalogue');
    $reject(fn () => $requirements->updateSettings($admin, [...$settings, 'unknown' => true]), 422, 'settings reject unknown top-level input', 'unknown');
    $invalid = $settings;
    $invalid['layers'][0]['unknown'] = 'smuggled';
    $reject(fn () => $requirements->updateSettings($admin, $invalid), 422, 'layer definitions reject unexpected nested fields');
    $invalid = $settings;
    $invalid['layers'][0]['fields'][0]['unknown'] = 'smuggled';
    $reject(fn () => $requirements->updateSettings($admin, $invalid), 422, 'field definitions reject unexpected nested fields');
    $invalid = $settings;
    $invalid['layers'][0]['fields'][0]['type'] = 'html';
    $reject(fn () => $requirements->updateSettings($admin, $invalid), 422, 'unsupported field types cannot enter a published form');
    $invalid = $settings;
    $invalid['layers'][0]['fields'][0]['key'] = '../private';
    $reject(fn () => $requirements->updateSettings($admin, $invalid), 422, 'field keys cannot contain path or dot notation');
    $invalid = $settings;
    $invalid['layers'][1]['id'] = 'enhanced';
    $reject(fn () => $requirements->updateSettings($admin, $invalid), 422, 'duplicate layer identifiers are rejected');
    $invalid = $settings;
    $invalid['layers'][0]['fields'][1]['key'] = 'occupation';
    $reject(fn () => $requirements->updateSettings($admin, $invalid), 422, 'duplicate field identifiers are rejected within a layer');
    $invalid = $settings;
    $invalid['layers'][0]['fields'][3]['options'] = [];
    $reject(fn () => $requirements->updateSettings($admin, $invalid), 422, 'selection fields require explicit available options');
    $check($requirements->settingsData() === $settings, 'invalid edits leave the entire published catalogue unchanged');

    $assignmentInput = ['version' => 0, 'layer_ids' => ['enhanced', 'residency'], 'reason' => 'Please complete an additional account review before your next withdrawal.'];
    $reject(fn () => $requirements->updateUser($member, $other, $assignmentInput), 403, 'customers cannot assign their own requirements');
    $reject(fn () => $requirements->updateUser($member, $admin, [...$assignmentInput, 'layer_ids' => ['unknown']]), 422, 'assignments cannot reference nonexistent layers');
    $reject(fn () => $requirements->updateUser($member, $admin, [...$assignmentInput, 'layer_ids' => ['enhanced', 'enhanced']]), 422, 'assignments cannot duplicate the same layer');
    $requirements->updateUser($member, $admin, $assignmentInput);
    $assigned = $requirements->forUser($member);
    $check($assigned['version'] === 1 && count($assigned['layers']) === 2, 'an administrator assigns several ordered requirement layers to one customer');
    $check($assigned['reason'] === $assignmentInput['reason'], 'the selected customer receives the administrator explanation');
    $check($requirements->forUser($other)['version'] === 0 && $requirements->forUser($other)['layers'] === [], 'assigning one customer never changes another customer form');
    $check($kyc->summary($member)['status'] === 'additional_required', 'a previous approval reports additional verification after assignment');
    $check($kyc->summary($member)['requirements_changed'] === true, 'customers can distinguish new requirements from a previous rejection');
    $check((array) DB::table('kyc_submissions')->where('id', $original->id)->first() === (array) $originalRaw, 'new requirements do not rewrite historical approved identity data or decisions');

    $wallet->credit($member, 100000, 'deposit', 'layers-fixture-deposit');
    $beforeWallet = $member->fresh()->wallet_balance;
    $beforeRequests = WalletRequest::count();
    $beforeLedger = WalletTransaction::count();
    $reject(fn () => $requests->create($member, 'withdrawal', 10000, 'bank_transfer', [], 'layers-blocked-withdrawal'), 422, 'new additional requirements block new withdrawal reservations', 'kyc');
    $check($member->fresh()->wallet_balance === $beforeWallet && WalletRequest::count() === $beforeRequests && WalletTransaction::count() === $beforeLedger, 'failed verification gating creates no withdrawal, balance change, or ledger row');
    $reject(fn () => $requirements->updateUser($member, $admin, $assignmentInput), 409, 'stale assignment revisions cannot overwrite newer customer requirements');
    $check($requirements->forUser($member) === $assigned, 'rejected stale assignment writes leave the selected form snapshot intact');
    $beforeAssignmentAudits = AdminAudit::where('action', 'kyc.user_requirements_updated')->count();
    $requirements->updateUser($member, $admin, [...$assignmentInput, 'version' => 1]);
    $check($requirements->forUser($member) === $assigned && AdminAudit::where('action', 'kyc.user_requirements_updated')->count() === $beforeAssignmentAudits, 'saving identical assignments changes neither revision nor audit history');

    $answers = fn (): array => [
        'enhanced' => [
            'occupation' => 'Synthetic occupation value',
            'funds_explanation' => 'Synthetic funds explanation supplied only for an isolated test.',
            'statement_date' => '2029-12-03', 'funds_source' => 'Employment',
            'declaration' => '1', 'supporting_document' => $upload('synthetic-supporting.png'),
        ],
        'residency' => ['residence' => 'Synthetic residence value', 'contact_consent' => '0'],
    ];
    $fullInput = fn (): array => [...$baseInput(), 'requirements_version' => 1, 'answers' => $answers()];
    $beforeFiles = $files();
    $reject(fn () => $kyc->submit($member, [...$baseInput(), 'answers' => $answers()]), 409, 'assigned forms require a matching explicit requirements revision');
    $reject(fn () => $kyc->submit($member, [...$fullInput(), 'requirements_version' => 0]), 409, 'stale customer forms cannot submit against changed requirements');
    $reject(fn () => $kyc->submit($member, [...$fullInput(), 'unexpected' => 'private']), 422, 'submissions reject unrecognized top-level fields', 'unexpected');
    $input = $fullInput();
    $input['answers']['unknown'] = ['field' => 'value'];
    $reject(fn () => $kyc->submit($member, $input), 422, 'submissions cannot inject an unassigned verification layer');
    $input = $fullInput();
    $input['answers']['enhanced']['unknown'] = 'value';
    $reject(fn () => $kyc->submit($member, $input), 422, 'submissions cannot inject an undefined layer field');
    foreach (['occupation', 'funds_explanation', 'statement_date', 'funds_source', 'declaration', 'supporting_document'] as $field) {
        $input = $fullInput();
        unset($input['answers']['enhanced'][$field]);
        $reject(fn () => $kyc->submit($member, $input), 422, 'assigned required '.$field.' cannot be omitted', 'answers.enhanced.'.$field);
    }
    foreach ([
        ['occupation', ['nested' => 'not a string']],
        ['occupation', str_repeat('x', 2001)],
        ['occupation', "contains\0control"],
        ['funds_explanation', str_repeat('x', 4001)],
        ['statement_date', 'not-a-date'],
        ['statement_date', '2030-02-31'],
        ['funds_source', 'Unlisted source'],
        ['declaration', '0'],
        ['supporting_document', $upload('not-an-image.png', 'plain text disguised as an image')],
        ['supporting_document', $upload('too-large.png', $image.str_repeat('x', 2048 * 1024))],
    ] as [$field, $value]) {
        $input = $fullInput();
        $input['answers']['enhanced'][$field] = $value;
        $reject(fn () => $kyc->submit($member, $input), 422, 'invalid dynamic '.$field.' is rejected by the service', 'answers.enhanced.'.$field);
    }
    $input = $fullInput();
    $input['answers']['residency']['contact_consent'] = 'not-a-boolean';
    $reject(fn () => $kyc->submit($member, $input), 422, 'optional checkbox answers must still be boolean', 'answers.residency.contact_consent');
    $input = $fullInput();
    $largeImage = $image.str_repeat('x', 1600 * 1024);
    $input['id_document'] = $upload('large-id.png', $largeImage);
    $input['selfie'] = $upload('large-selfie.png', $largeImage);
    $input['answers']['enhanced']['supporting_document'] = $upload('large-supporting.png', $largeImage);
    $input['answers']['residency']['additional_document'] = $upload('large-residency.png', $largeImage);
    $reject(fn () => $kyc->submit($member, $input), 422, 'several individually valid uploads cannot exceed the combined request budget', 'answers');
    $check($files() === $beforeFiles && KycSubmission::where('user_id', $member->id)->count() === 1, 'stale and invalid dynamic forms persist no documents or submissions');

    $submission = $kyc->submit($member, $fullInput());
    $check($submission->status === 'pending' && $submission->requirements_version === 1, 'updated requirements create a new pending submission with its accepted revision');
    $check($kyc->summary($member)['status'] === 'pending' && ! $kyc->summary($member)['requirements_changed'], 'current requirements show pending while administrators review the new submission');
    $check(count($files()) === count($beforeFiles) + 3, 'dynamic document joins the two base documents in private storage');
    $check($submission->answers['enhanced']['occupation'] === 'Synthetic occupation value', 'authorized services recover encrypted custom answers');
    $check($submission->answers['residency']['contact_consent'] === false, 'an unchecked optional declaration remains false instead of being silently treated as consent');
    $check(is_array($submission->answers['enhanced']['supporting_document']) && isset($submission->answers['enhanced']['supporting_document']['document_kind']), 'uploaded answers store an authorized document reference rather than upload contents');
    $raw = (array) DB::table('kyc_submissions')->where('id', $submission->id)->first();
    $check(! str_contains($raw['answers'], 'Synthetic occupation value') && ! str_contains($raw['answers'], 'Synthetic residence value'), 'custom identity answers are ciphertext in the database');
    $check(! str_contains($raw['requirements_snapshot'], $assignmentInput['reason']), 'user-specific requirement snapshots are encrypted in the database');
    $assignmentRaw = (array) DB::table('kyc_user_requirements')->where('user_id', $member->id)->first();
    $check(! str_contains($assignmentRaw['reason'], 'additional account review') && ! str_contains($assignmentRaw['layers'], 'Supporting document'), 'user assignment reasons and captured layer definitions are encrypted');
    $serialized = $submission->toArray();
    $check(! array_key_exists('answers', $serialized) && ! array_key_exists('requirements_snapshot', $serialized) && ! array_key_exists('documents', $serialized), 'ordinary model serialization hides all submitted private data');
    foreach ($files() as $file) {
        $ciphertext = Storage::disk('kyc')->get($file);
        $check(! str_starts_with($ciphertext, "\x89PNG") && ! str_contains($ciphertext, $image), 'persisted uploads contain ciphertext rather than original image bytes');
    }
    $beforeDuplicate = $files();
    $reject(fn () => $kyc->submit($member, $fullInput()), 409, 'a matching pending requirements submission cannot be duplicated');
    $check($files() === $beforeDuplicate, 'duplicate submission rejection cleans all tentative encrypted uploads');

    $detail = $kyc->detailData($submission);
    $detailJson = json_encode($detail, JSON_THROW_ON_ERROR);
    $check(str_contains($detailJson, 'Synthetic occupation value') && str_contains($detailJson, 'Supporting document'), 'administrators receive the accepted field labels and decrypted answers for review');
    $check(! str_contains($detailJson, '.enc') && ! str_contains($detailJson, 'sha256'), 'review responses never disclose private storage paths or checksums');
    $listJson = json_encode($kyc->listData($submission), JSON_THROW_ON_ERROR);
    $check(! str_contains($listJson, 'Synthetic occupation value') && ! str_contains($listJson, 'additional account review'), 'the review queue omits custom answers and user-specific explanations');
    $documentKey = null;
    foreach ($detail['documents'] as $kind => $document) {
        if (! in_array($kind, ['id_document', 'selfie'], true)) {
            $documentKey = $kind;
            $check(str_starts_with($document['download_url'], '/api/kyc/'.$submission->id.'/documents/'), 'custom uploads use the authenticated document route');
        }
    }
    $check($documentKey !== null, 'a custom supporting upload is exposed for authorized download');
    $check($kyc->document($submission, $member, $documentKey)['contents'] === $image, 'document owners can download the original custom file');
    $check($kyc->document($submission, $admin, $documentKey)['contents'] === $image, 'administrators can download custom files for review');
    $reject(fn () => $kyc->document($submission, $other, $documentKey), 404, 'another member cannot access custom documents');
    $reject(fn () => $kyc->document($submission, $member, '../outside'), 404, 'custom document download keys cannot traverse storage');

    $submission = $approve($submission);
    $check($kyc->summary($member)['status'] === 'approved', 'administrator approval of all current layers restores verified status');
    $kyc->assertWithdrawalApproved($member);
    $withdrawal = $requests->create($member, 'withdrawal', 10000, 'bank_transfer', [], 'layers-approved-withdrawal');
    $check($withdrawal->status === 'pending' && $member->fresh()->wallet_balance === $beforeWallet - 10000, 'matching approved requirements permit an ordinary reserved withdrawal');
    $approvedRaw = (array) DB::table('kyc_submissions')->where('id', $submission->id)->first();

    // Published template edits never silently alter a user's already captured requirements.
    $editedSettings = $requirements->settingsData();
    $editedSettings['reason'] = 'Our updated verification explanation describes the account review process.';
    $editedSettings['layers'][0]['fields'][0]['label'] = 'Updated occupation label';
    $requirements->updateSettings($admin, $editedSettings);
    $check($requirements->forUser($member)['layers'] === $assigned['layers'], 'template edits preserve each assigned layer snapshot until administrator reassignment');
    $check($requirements->forUser($member)['version'] === 1 && $kyc->summary($member)['status'] === 'approved', 'global explanation and template edits cannot invalidate an existing customer approval');
    $check($kyc->summary($other)['reason'] === $editedSettings['reason'], 'customers without a custom explanation see the latest general verification reason');
    $check((array) DB::table('kyc_submissions')->where('id', $submission->id)->first() === $approvedRaw, 'settings changes do not mutate the approved submission snapshot');

    // Pending reviews must match the currently assigned revision, even if the form changed in another tab.
    $requirements->updateUser($pendingMember, $admin, ['version' => 0, 'layer_ids' => ['residency'], 'reason' => 'Additional address confirmation is required for this account.']);
    $reject(fn () => $approve($pendingOriginal), 409, 'an outdated pending submission cannot approve a newer set of requirements');
    $check($pendingOriginal->fresh()->status === 'pending', 'stale review rejection preserves the earlier submission history');
    $check($kyc->summary($pendingMember)['status'] === 'additional_required', 'a pending user sees that additional requirements supersede their old form');
    $replacement = $kyc->submit($pendingMember, [...$baseInput(), 'requirements_version' => 1, 'answers' => ['residency' => ['residence' => 'Synthetic replacement residence']]]);
    $check($replacement->id !== $pendingOriginal->id && $replacement->status === 'pending', 'a user can submit current requirements while the older version remains in history');
    $requirements->updateUser($pendingMember, $admin, ['version' => 1, 'layer_ids' => [], 'reason' => 'Additional requirements have been removed following manual review.']);
    $reject(fn () => $approve($replacement), 409, 'removing assigned layers also invalidates a pending review with an older revision');
    $reject(fn () => $kyc->submit($pendingMember, $baseInput()), 409, 'customers must acknowledge a changed revision even when extra layers were removed');
    $baseAgain = $kyc->submit($pendingMember, [...$baseInput(), 'requirements_version' => 2]);
    $approve($baseAgain);
    $check($kyc->summary($pendingMember)['status'] === 'approved', 'base verification remains possible after administrator removal of extra layers');

    // Two administrators working from the same revision must never both succeed.
    if (function_exists('pcntl_fork')) {
        $raceMember = $user('Concurrent Requirements Member');
        $raceDirectory = $directory.'/assignment-race';
        mkdir($raceDirectory, 0700);
        $beforeRaceAudits = AdminAudit::where('action', 'kyc.user_requirements_updated')->count();
        DB::disconnect('sqlite');
        $children = [];
        for ($index = 0; $index < 2; $index++) {
            $pid = pcntl_fork();
            if ($pid === -1) {
                throw new RuntimeException('Unable to start assignment concurrency check.');
            }
            if ($pid === 0) {
                DB::purge('sqlite');
                $deadline = microtime(true) + 10;
                while (! is_file($raceDirectory.'/start') && microtime(true) < $deadline) {
                    usleep(1000);
                }
                try {
                    app(KycRequirementsService::class)->updateUser($raceMember, $admin, [
                        'version' => 0, 'layer_ids' => [$index === 0 ? 'enhanced' : 'residency'],
                        'reason' => 'Synthetic concurrent administrator assignment '.$index,
                    ]);
                    $result = ['status' => 'saved'];
                } catch (HttpExceptionInterface $error) {
                    $result = ['status' => 'rejected', 'code' => $error->getStatusCode()];
                } catch (Throwable $error) {
                    $result = ['status' => 'error', 'class' => get_class($error), 'message' => $error->getMessage()];
                }
                file_put_contents($raceDirectory.'/'.$index.'.json', json_encode($result, JSON_THROW_ON_ERROR));
                exit(0);
            }
            $children[] = $pid;
        }
        touch($raceDirectory.'/start');
        foreach ($children as $pid) {
            pcntl_waitpid($pid, $status);
            $check(pcntl_wifexited($status) && pcntl_wexitstatus($status) === 0, 'concurrent assignment worker exits normally');
        }
        DB::purge('sqlite');
        $results = array_map(fn ($index) => json_decode(file_get_contents($raceDirectory.'/'.$index.'.json'), true, flags: JSON_THROW_ON_ERROR), [0, 1]);
        $check(count(array_filter($results, fn ($result) => $result['status'] === 'saved')) === 1, 'exactly one concurrent administrator assignment is saved');
        $check(count(array_filter($results, fn ($result) => $result['status'] === 'rejected' && $result['code'] === 409)) === 1, 'the competing administrator receives a stale-revision conflict');
        $check($requirements->forUser($raceMember)['version'] === 1 && DB::table('kyc_user_requirements')->where('user_id', $raceMember->id)->count() === 1, 'concurrent assignment writes produce one row with one revision');
        $check(AdminAudit::where('action', 'kyc.user_requirements_updated')->count() === $beforeRaceAudits + 1, 'only the committed concurrent assignment produces an audit entry');
    }

    $requirements->updateUser($member, $admin, [...$assignmentInput, 'version' => 1]);
    $current = $requirements->forUser($member);
    $check($current['version'] === 2 && $current['layers'][0]['fields'][0]['label'] === 'Updated occupation label', 'explicit reassignment captures the newly published template in a new user revision');
    $check($kyc->summary($member)['status'] === 'additional_required', 'an explicitly changed customer form requires a new approved submission');
    $check((array) DB::table('kyc_submissions')->where('id', $submission->id)->first() === $approvedRaw, 'reassignment never modifies an earlier approved submission');
    $reject(fn () => $requests->create($member, 'withdrawal', 10000, 'bank_transfer', [], 'layers-reassigned-withdrawal'), 422, 'a changed assigned snapshot blocks only new unverified withdrawals', 'kyc');

    $auditJson = DB::table('admin_audits')->get()->toJson();
    foreach (['Synthetic occupation value', 'Synthetic residence value', 'SYNTHETIC-LAYER-0001', 'additional account review', 'Supporting document', '.enc'] as $privateValue) {
        $check(! str_contains($auditJson, $privateValue), 'general audit history excludes private verification value '.$privateValue);
    }
    $check(AdminAudit::where('action', 'kyc.approved')->exists(), 'verification approvals remain audited');
    $check($requests->create($member, 'withdrawal', 10000, 'bank_transfer', [], 'layers-approved-withdrawal')->id === $withdrawal->id, 'existing financial idempotency survives configurable verification requirements');
    $check($member->fresh()->wallet_balance === WalletTransaction::where('user_id', $member->id)->sum('amount'), 'configurable verification never changes the wallet ledger invariant');

    echo "Passed {$count} configurable KYC integration checks.\n";
} catch (Throwable $error) {
    fwrite(STDERR, get_class($error).': '.$error->getMessage()."\n");
    $failure = true;
} finally {
    CarbonImmutable::setTestNow();
    if (isset($app)) {
        DB::disconnect('sqlite');
    }
    $remove = function (string $path) use (&$remove): void {
        if (is_dir($path) && ! is_link($path)) {
            foreach (array_diff(scandir($path), ['.', '..']) as $name) {
                $remove($path.'/'.$name);
            }
            rmdir($path);
        } elseif (file_exists($path)) {
            unlink($path);
        }
    };
    $remove($directory);
}
if ($failure ?? false) {
    exit(1);
}
