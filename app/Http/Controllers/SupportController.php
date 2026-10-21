<?php

namespace App\Http\Controllers;

use App\Models\SupportConversation;
use App\Services\StakingRules;
use App\Services\SupportService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class SupportController extends ApiController
{
    public function current(Request $request, SupportService $service): JsonResponse
    {
        $this->input($request, []);
        $conversation = $service->current($request->user());

        return $this->json(['conversation' => $conversation ? $service->data($conversation, $request->user()) : null, 'assistant' => $service->assistantData()]);
    }

    public function start(Request $request, SupportService $service): JsonResponse
    {
        $this->input($request, []);

        return $this->conversation($request, $service, $service->start($request->user()), 201);
    }

    public function show(Request $request, SupportConversation $conversation, SupportService $service): JsonResponse
    {
        // Customer routes remain owner-only, including when the customer is an admin.
        abort_unless($conversation->user_id === $request->user()->id, 403, 'This conversation is private.');
        $input = $this->input($request, ['before_id' => ['sometimes', 'integer', 'min:1']]);

        return $this->json(['conversation' => $service->data($conversation, $request->user(), isset($input['before_id']) ? (int) $input['before_id'] : null), 'assistant' => $service->assistantData()]);
    }

    public function message(Request $request, SupportConversation $conversation, SupportService $service): JsonResponse
    {
        $input = $this->input($request, $this->messageRules());

        return $this->conversation($request, $service, $service->send($conversation, $request->user(), $input));
    }

    public function handover(Request $request, SupportConversation $conversation, SupportService $service): JsonResponse
    {
        $this->input($request, []);

        return $this->conversation($request, $service, $service->handover($conversation, $request->user()));
    }

    public function inbox(Request $request, SupportService $service): JsonResponse
    {
        StakingRules::admin($request->user());
        $input = $this->input($request, [
            'status' => ['sometimes', Rule::in(['all', 'bot', 'waiting', 'admin', 'resolved'])],
            'page' => ['sometimes', 'integer', 'min:1'],
        ]);
        $status = $input['status'] ?? 'waiting';
        $rows = SupportConversation::with(['user', 'assignedAdmin'])->when($status !== 'all', fn ($query) => $query->where('status', $status))
            ->orderByDesc('last_message_at')->orderByDesc('id')->paginate(20);

        return $this->json([
            'conversations' => $rows->getCollection()->map(fn ($conversation) => $service->summary($conversation, $request->user()))->all(),
            'pagination' => ['current_page' => $rows->currentPage(), 'last_page' => $rows->lastPage(), 'total' => $rows->total(), 'per_page' => $rows->perPage()],
        ]);
    }

    public function adminShow(Request $request, SupportConversation $conversation, SupportService $service): JsonResponse
    {
        StakingRules::admin($request->user());
        $input = $this->input($request, ['before_id' => ['sometimes', 'integer', 'min:1']]);

        return $this->json(['conversation' => $service->data($conversation, $request->user(), isset($input['before_id']) ? (int) $input['before_id'] : null), 'assistant' => $service->assistantData()]);
    }

    public function claim(Request $request, SupportConversation $conversation, SupportService $service): JsonResponse
    {
        StakingRules::admin($request->user());
        $input = $this->input($request, ['version' => ['required', 'integer', 'min:1']]);

        return $this->conversation($request, $service, $service->claim($conversation, $request->user(), (int) $input['version']));
    }

    public function reply(Request $request, SupportConversation $conversation, SupportService $service): JsonResponse
    {
        StakingRules::admin($request->user());
        $input = $this->input($request, $this->messageRules() + ['version' => ['required', 'integer', 'min:1']]);

        return $this->conversation($request, $service, $service->reply($conversation, $request->user(), $input));
    }

    public function resolve(Request $request, SupportConversation $conversation, SupportService $service): JsonResponse
    {
        StakingRules::admin($request->user());
        $input = $this->input($request, ['version' => ['required', 'integer', 'min:1']]);

        return $this->conversation($request, $service, $service->resolve($conversation, $request->user(), (int) $input['version']));
    }

    private function messageRules(): array
    {
        return ['body' => ['required', 'string', 'min:1', 'max:2000'], 'idempotency_key' => ['required', 'string', 'min:16', 'max:100', 'regex:/\A[A-Za-z0-9_-]+\z/D']];
    }

    private function conversation(Request $request, SupportService $service, SupportConversation $conversation, int $status = 200): JsonResponse
    {
        return $this->json(['conversation' => $service->data($conversation->fresh(), $request->user()), 'assistant' => $service->assistantData()], $status);
    }

    private function json(array $data, int $status = 200): JsonResponse
    {
        return response()->json($data, $status)->header('Cache-Control', 'private, no-store, max-age=0')->header('Pragma', 'no-cache')->header('X-Content-Type-Options', 'nosniff');
    }
}
