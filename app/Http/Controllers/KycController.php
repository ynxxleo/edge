<?php

namespace App\Http\Controllers;

use App\Models\KycSubmission;
use App\Services\KycService;
use App\Services\StakingRules;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Validation\Rule;

class KycController extends ApiController
{
    public function show(Request $request, KycService $service): JsonResponse
    {
        return $this->json(['kyc' => $service->summary($request->user())]);
    }

    public function store(Request $request, KycService $service): JsonResponse
    {
        $request->merge(KycService::normalize($request->only([
            'legal_name', 'date_of_birth', 'country', 'address', 'document_type', 'document_number',
        ])));
        $input = $this->input($request, KycService::rules());
        $submission = $service->submit($request->user(), $input);

        return $this->json(['kyc' => $service->summary($request->user(), $submission)], 201);
    }

    public function adminIndex(Request $request, KycService $service): JsonResponse
    {
        StakingRules::admin($request->user());
        $input = $this->input($request, [
            'status' => ['sometimes', Rule::in(['all', 'pending', 'approved', 'rejected'])],
            'page' => ['sometimes', 'integer', 'min:1'],
        ]);
        $status = $input['status'] ?? 'pending';
        $submissions = KycSubmission::with('user')
            ->when($status !== 'all', fn ($query) => $query->where('status', $status))
            ->latest('id')->paginate(20);

        return $this->json([
            'submissions' => $submissions->getCollection()->map($service->listData(...))->all(),
            'pagination' => [
                'current_page' => $submissions->currentPage(), 'last_page' => $submissions->lastPage(),
                'total' => $submissions->total(), 'per_page' => $submissions->perPage(),
            ],
        ]);
    }

    public function adminShow(Request $request, KycSubmission $submission, KycService $service): JsonResponse
    {
        StakingRules::admin($request->user());

        return $this->json(['submission' => $service->detailData($submission)]);
    }

    public function review(Request $request, KycSubmission $submission, KycService $service): JsonResponse
    {
        StakingRules::admin($request->user());
        $input = $this->input($request, [
            'version' => ['required', 'integer', 'min:1'],
            'decision' => ['required', Rule::in(['approved', 'rejected'])],
            'review_note' => ['required_if:decision,rejected', 'nullable', 'string', 'min:10', 'max:1500'],
        ]);
        $submission = $service->review($submission, $request->user(), $input);

        return $this->json(['submission' => $service->detailData($submission)]);
    }

    public function document(Request $request, KycSubmission $submission, string $kind, KycService $service): Response
    {
        $document = $service->document($submission, $request->user(), $kind);
        $extension = match ($document['mime_type']) {
            'application/pdf' => 'pdf', 'image/jpeg' => 'jpg', 'image/png' => 'png',
            default => abort(404),
        };
        $filename = ($kind === 'selfie' ? 'selfie' : 'identity-document').'.'.$extension;

        return response($document['contents'], 200, [
            'Content-Type' => $document['mime_type'],
            'Content-Disposition' => 'attachment; filename="'.$filename.'"',
            'Content-Length' => (string) strlen($document['contents']),
            'Cache-Control' => 'private, no-store, max-age=0',
            'Pragma' => 'no-cache',
            'X-Content-Type-Options' => 'nosniff',
            'X-Frame-Options' => 'DENY',
            'Content-Security-Policy' => "sandbox; default-src 'none'",
        ]);
    }

    private function json(array $data, int $status = 200): JsonResponse
    {
        return response()->json($data, $status)
            ->header('Cache-Control', 'private, no-store, max-age=0')
            ->header('Pragma', 'no-cache')
            ->header('X-Content-Type-Options', 'nosniff');
    }
}
