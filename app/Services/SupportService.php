<?php

namespace App\Services;

use App\Models\AdminAudit;
use App\Models\Bet;
use App\Models\CopyPosition;
use App\Models\StripePayment;
use App\Models\SupportConversation;
use App\Models\SupportMessage;
use App\Models\User;
use App\Models\WalletRequest;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

final class SupportService
{
    public function __construct(private SupportIntentService $intents) {}

    public function assistantData(): array
    {
        return ['mode' => 'local', 'label' => 'Built-in account assistant'];
    }

    public function current(User $user): ?SupportConversation
    {
        return SupportConversation::where('user_id', $user->id)->latest('id')->first();
    }

    public function start(User $user): SupportConversation
    {
        return StakingTransaction::run(function () use ($user) {
            User::lockForUpdate()->findOrFail($user->id);
            $existing = SupportConversation::where('active_user_id', $user->id)->lockForUpdate()->first();
            if ($existing) {
                return $existing;
            }
            $conversation = SupportConversation::create([
                'user_id' => $user->id, 'active_user_id' => $user->id,
                'status' => 'bot', 'version' => 1, 'bot_answers' => 0,
            ]);
            $this->append($conversation, 'assistant', 'Hello! I am your built-in account assistant. I can check your wallet balance, deposit and withdrawal requests, verification status, bets and copy staking. Ask up to three account questions, or choose “Talk to an admin” at any time. Please do not share passwords, card details or identity documents here.', null, null, 'local');
            $this->audit($user, 'support.started', $conversation, null);

            return $conversation->fresh();
        });
    }

    public function send(SupportConversation $conversation, User $user, array $input): SupportConversation
    {
        $this->owner($conversation, $user);
        $input = $this->messageInput($input);
        $hash = $this->messageHash($user, $input['idempotency_key']);
        if ($this->existingMessage($conversation, $user, $hash, $input['body'])) {
            return $conversation->fresh();
        }
        abort_if($conversation->fresh()->status === 'resolved', 409, 'This conversation is resolved. Start a new conversation.');
        $classification = $conversation->fresh()->status === 'bot'
            ? $this->intents->classify($input['body']) : ['intent' => 'handoff', 'mode' => 'local'];

        return $this->locked($conversation, function (SupportConversation $locked) use ($user, $input, $hash, $classification) {
            if ($this->existingMessage($locked, $user, $hash, $input['body'])) {
                return $locked;
            }
            abort_if($locked->status === 'resolved', 409, 'This conversation is resolved. Start a new conversation.');
            $locked->version++;
            $this->append($locked, 'user', $input['body'], $user, $hash);
            if ($locked->status === 'bot') {
                if ($classification['intent'] === 'handoff') {
                    $this->queue($locked, $user, 'An admin can help with this. Your conversation is in the support queue. You can add more details here while you wait.');
                } else {
                    $answer = $this->answer($classification['intent'], $user);
                    $this->append($locked, 'assistant', $answer, null, null, $classification['mode']);
                    if ($classification['intent'] !== 'greeting') {
                        $locked->bot_answers++;
                    }
                    if ($locked->bot_answers >= max(1, min(3, (int) config('support.max_bot_answers', 3)))) {
                        $this->queue($locked, $user, 'I have answered three account questions. Your conversation is now in the admin support queue for further help. You can add a message while you wait.');
                    }
                }
            }
            $locked->save();

            return $locked;
        });
    }

    public function handover(SupportConversation $conversation, User $user): SupportConversation
    {
        $this->owner($conversation, $user);

        return $this->locked($conversation, function (SupportConversation $locked) use ($user) {
            abort_if($locked->status === 'resolved', 409, 'This conversation is resolved. Start a new conversation.');
            if ($locked->status === 'bot') {
                $locked->version++;
                $this->queue($locked, $user, 'You have requested an admin. Your conversation is in the support queue. You can add more details while you wait.');
                $locked->save();
            }

            return $locked;
        });
    }

    public function claim(SupportConversation $conversation, User $admin, int $version): SupportConversation
    {
        $this->admin($conversation, $admin);

        return $this->locked($conversation, function (SupportConversation $locked) use ($admin, $version) {
            if ($locked->status === 'admin' && $locked->assigned_admin_id === $admin->id) {
                return $locked;
            }
            $this->version($locked, $version);
            abort_unless(in_array($locked->status, ['bot', 'waiting'], true), 409, 'This conversation has already been claimed or resolved.');
            $before = $locked->status;
            $locked->status = 'admin';
            $locked->assigned_admin_id = $admin->id;
            $locked->version++;
            $this->append($locked, 'system', 'An admin has joined the conversation. Automated replies are now paused.');
            $locked->save();
            $this->audit($admin, 'support.claimed', $locked, $before);

            return $locked;
        });
    }

    public function reply(SupportConversation $conversation, User $admin, array $input): SupportConversation
    {
        $this->admin($conversation, $admin);
        $input = $this->messageInput($input, true);
        $hash = $this->messageHash($admin, $input['idempotency_key']);

        return $this->locked($conversation, function (SupportConversation $locked) use ($admin, $input, $hash) {
            if ($this->existingMessage($locked, $admin, $hash, $input['body'])) {
                return $locked;
            }
            abort_if($locked->assigned_admin_id !== null && $locked->assigned_admin_id !== $admin->id, 403, 'Only the assigned admin can reply to this conversation.');
            $this->version($locked, (int) $input['version']);
            abort_unless($locked->status === 'admin' && $locked->assigned_admin_id === $admin->id, 409, 'Claim this conversation before replying. Only the assigned admin can reply.');
            $this->append($locked, 'admin', $input['body'], $admin, $hash);
            $locked->version++;
            $locked->save();
            $this->audit($admin, 'support.replied', $locked, 'admin');

            return $locked;
        });
    }

    public function resolve(SupportConversation $conversation, User $admin, int $version): SupportConversation
    {
        $this->admin($conversation, $admin);

        return $this->locked($conversation, function (SupportConversation $locked) use ($admin, $version) {
            if ($locked->status === 'resolved' && $locked->assigned_admin_id === $admin->id) {
                return $locked;
            }
            abort_if($locked->assigned_admin_id !== null && $locked->assigned_admin_id !== $admin->id, 403, 'Only the assigned admin can resolve this conversation.');
            $this->version($locked, $version);
            abort_unless($locked->status === 'admin' && $locked->assigned_admin_id === $admin->id, 409, 'Only the assigned admin can resolve this conversation.');
            $locked->status = 'resolved';
            $locked->active_user_id = null;
            $locked->resolved_at = now();
            $locked->version++;
            $this->append($locked, 'system', 'This conversation has been resolved by the admin. Start a new conversation if you need more help.');
            $locked->save();
            $this->audit($admin, 'support.resolved', $locked, 'admin');

            return $locked;
        });
    }

    public function data(SupportConversation $conversation, User $viewer, ?int $beforeId = null): array
    {
        abort_unless($conversation->user_id === $viewer->id || $viewer->is_admin, 403, 'This conversation is private.');
        $data = $this->summary($conversation, $viewer);
        $limit = max(1, min(100, (int) config('support.history_limit', 100)));
        $rows = $conversation->messages()->with('sender')->when($beforeId !== null, fn ($query) => $query->where('id', '<', $beforeId))->latest('id')->limit($limit + 1)->get();
        $data['has_more'] = $rows->count() > $limit;
        $rows = $rows->take($limit)->reverse()->values();
        $data['before_id'] = $rows->first()?->id;
        $data['messages'] = $rows->map(fn (SupportMessage $message) => [
            'id' => $message->id, 'role' => $message->role, 'body' => $message->body,
            'sender_name' => match ($message->role) {
                'assistant' => 'Built-in account assistant',
                'system' => 'Support',
                'admin' => $message->sender?->name ?? 'Admin',
                default => $conversation->user_id === $viewer->id ? 'You' : ($message->sender?->name ?? 'Customer'),
            },
            'automation_mode' => $message->role === 'assistant' ? 'local' : null,
            'created_at' => $message->created_at?->toIso8601String(),
        ])->all();

        return $data;
    }

    public function summary(SupportConversation $conversation, User $viewer): array
    {
        abort_unless($conversation->user_id === $viewer->id || $viewer->is_admin, 403, 'This conversation is private.');
        $data = [
            'id' => $conversation->id, 'status' => $conversation->status, 'version' => $conversation->version,
            'bot_answers' => $conversation->bot_answers,
            'created_at' => $conversation->created_at?->toIso8601String(),
            'last_message_at' => $conversation->last_message_at?->toIso8601String(),
            'resolved_at' => $conversation->resolved_at?->toIso8601String(),
            'assigned_admin' => $conversation->assigned_admin_id ? ['id' => $conversation->assigned_admin_id, 'name' => $conversation->assignedAdmin?->name ?? 'Admin'] : null,
        ];
        if ($viewer->is_admin) {
            $data['user'] = ['id' => $conversation->user_id, 'name' => $conversation->user?->name, 'email' => $conversation->user?->email];
        }

        return $data;
    }

    private function locked(SupportConversation $conversation, callable $callback): SupportConversation
    {
        return StakingTransaction::run(function () use ($conversation, $callback) {
            User::lockForUpdate()->findOrFail($conversation->user_id);
            $locked = SupportConversation::lockForUpdate()->findOrFail($conversation->id);

            return $callback($locked);
        });
    }

    private function owner(SupportConversation $conversation, User $user): void
    {
        abort_unless($conversation->user_id === $user->id, 403, 'This conversation is private.');
    }

    private function admin(SupportConversation $conversation, User $admin): void
    {
        StakingRules::admin($admin);
        abort_if($conversation->user_id === $admin->id, 403, 'You cannot handle your own support conversation.');
    }

    private function version(SupportConversation $conversation, int $version): void
    {
        abort_unless($conversation->version === $version, 409, 'This conversation changed. Refresh before continuing.');
    }

    private function messageInput(array $input, bool $admin = false): array
    {
        $allowed = $admin ? ['body', 'idempotency_key', 'version'] : ['body', 'idempotency_key'];
        $unknown = array_diff(array_keys($input), $allowed);
        if ($unknown) {
            throw ValidationException::withMessages(array_fill_keys($unknown, ['This field is not accepted.']));
        }
        if (is_string($input['body'] ?? null)) {
            $input['body'] = trim($input['body']);
        }
        $rules = [
            'body' => ['required', 'string', 'min:1', 'max:2000', 'regex:/\A[^\x00-\x08\x0B\x0C\x0E-\x1F\x7F]*\z/u'],
            'idempotency_key' => ['required', 'string', 'min:16', 'max:100', 'regex:/\A[A-Za-z0-9_-]+\z/D'],
        ];
        if ($admin) {
            $rules['version'] = ['required', 'integer', 'min:1'];
        }

        return Validator::make($input, $rules)->validate();
    }

    private function messageHash(User $sender, string $key): string
    {
        return hash('sha256', $sender->id.':'.$key);
    }

    private function existingMessage(SupportConversation $conversation, User $sender, string $hash, string $body): ?SupportMessage
    {
        $existing = $conversation->messages()->where('idempotency_hash', $hash)->first();
        if ($existing && ($existing->sender_id !== $sender->id || ! hash_equals($existing->body, $body))) {
            abort(409, 'This request key was already used for a different message.');
        }

        return $existing;
    }

    private function append(SupportConversation $conversation, string $role, string $body, ?User $sender = null, ?string $hash = null, ?string $mode = null): void
    {
        $conversation->messages()->create([
            'sender_id' => $sender?->id, 'role' => $role, 'body' => $body,
            'idempotency_hash' => $hash, 'automation_mode' => $mode,
        ]);
        $conversation->last_message_at = now();
        $conversation->save();
    }

    private function queue(SupportConversation $conversation, User $user, string $body): void
    {
        $before = $conversation->status;
        $conversation->status = 'waiting';
        $this->append($conversation, 'system', $body);
        $this->audit($user, 'support.handover', $conversation, $before);
    }

    private function answer(string $intent, User $user): string
    {
        return match ($intent) {
            'balance' => 'Your available wallet balance is '.$this->money((int) $user->fresh()->wallet_balance).'. This is the available wallet amount; pending withdrawals and copy staking positions are shown separately in your wallet and copy staking pages.',
            'kyc' => $this->kycAnswer($user),
            'deposits' => $this->requestsAnswer($user, 'deposit'),
            'withdrawals' => $this->requestsAnswer($user, 'withdrawal'),
            'bets' => $this->betsAnswer($user),
            'copy' => $this->copyAnswer($user),
            'deposit_help' => 'Open Wallet → Deposit and choose an available payment method. For a manual transfer, use the receiving details shown there and submit your payment request. Funds appear after an admin confirms receipt. Card deposits are available only when enabled for this platform.',
            'withdrawal_help' => 'Open Wallet → Withdraw. Identity verification must be approved before you can request a withdrawal. Choose an available amount and enter the requested payout details. Submitted withdrawals await admin review; support cannot release funds or promise a completion time.',
            'kyc_help' => 'Open Identity verification, read the reason for the check, then complete the details and any additional requirements assigned to your account. Upload documents in the verification form and submit for admin review. Do not send identity documents in chat.',
            default => 'I can help with your wallet balance, deposit or withdrawal status, verification status, bets and copy staking. Choose a topic, or ask to talk to an admin.',
        };
    }

    private function money(int $amount, ?string $currency = null): string
    {
        return ($currency ?? StakingCurrency::code()).' '.number_format($amount / 100, 2, '.', ',');
    }

    private function kycAnswer(User $user): string
    {
        $status = app(KycService::class)->summary($user)['status'];
        $label = match ($status) {
            'approved' => 'approved', 'pending' => 'pending admin review', 'rejected' => 'changes needed',
            'additional_required' => 'additional verification required', default => str_replace('_', ' ', $status),
        };

        return 'Your verification status is: '.$label.'. Open Identity verification to see your current requirements and any review feedback. Admin approval is required before withdrawing.';
    }

    private function requestsAnswer(User $user, string $type): string
    {
        $requests = WalletRequest::where('user_id', $user->id)->where('type', $type)->latest('id')->limit(3)->get(['id', 'amount', 'status', 'created_at']);
        $cards = $type === 'deposit' ? StripePayment::where('user_id', $user->id)->latest('id')->limit(3)->get(['id', 'amount', 'currency', 'status', 'created_at']) : collect();
        if ($requests->isEmpty() && $cards->isEmpty()) {
            return 'There are no '.$type.' requests on your account. Open Wallet to view payment activity or create a request.';
        }
        $items = $requests->map(fn ($request) => '#'.$request->id.' — '.$this->money($request->amount).' — '.$request->status.' ('.$request->created_at->format('d M Y').')')->implode("\n");
        $answer = $requests->isEmpty() ? 'There are no manual deposit requests on your account.' : 'Your latest '.$type." requests:\n".$items;
        if ($cards->isNotEmpty()) {
            $answer .= "\nYour latest card deposits:\n".$cards->map(fn ($payment) => '#'.$payment->id.' — '.$this->money($payment->amount, strtoupper($payment->currency)).' — '.$payment->status.' ('.$payment->created_at->format('d M Y').')')->implode("\n");
            $answer .= "\nCard deposits are credited only when their payment status is paid.";
        }

        return $answer."\nPending manual requests need admin review. See Wallet for the full payment history.";
    }

    private function betsAnswer(User $user): string
    {
        $counts = Bet::where('user_id', $user->id)->selectRaw('status, COUNT(*) AS total')->groupBy('status')->pluck('total', 'status');
        if ($counts->isEmpty()) {
            return 'You have no bets on your account yet. Open My bets to view future stakes and results.';
        }
        $allowed = ['pending', 'won', 'lost', 'void'];
        $parts = collect($allowed)->filter(fn ($status) => isset($counts[$status]))->map(fn ($status) => $counts[$status].' '.$status)->implode(', ');

        return 'Your bet summary: '.$parts.'. Open My bets for teams, stakes and settled payouts. Results are settled after an admin records the final game scores.';
    }

    private function copyAnswer(User $user): string
    {
        $positions = CopyPosition::where('user_id', $user->id)->whereIn('status', ['active', 'paused'])
            ->with(['stakes' => fn ($query) => $query->where('status', 'pending')])->get();
        if ($positions->isEmpty()) {
            return 'You have no active or paused copy staking positions. Open Copy staking to see available masters and your position history.';
        }
        $reserved = (int) $positions->sum(fn ($position) => $position->stakes->sum('stake'));
        $available = (int) $positions->sum('value');

        return 'You have '.$positions->where('status', 'active')->count().' active and '.$positions->where('status', 'paused')->count().' paused copy staking position(s). Deposited principal: '.$this->money((int) $positions->sum('principal')).'. Available position funds: '.$this->money($available).'. Reserved for pending games: '.$this->money($reserved).'. Total position equity: '.$this->money($available + $reserved).'. Recorded profit/loss: '.$this->money((int) $positions->sum('profit')).'. Open Copy staking for your chart and the master’s game results. Future returns are not guaranteed.';
    }

    private function audit(User $actor, string $action, SupportConversation $conversation, ?string $before): void
    {
        AdminAudit::create([
            'actor_id' => $actor->id, 'action' => $action, 'subject_type' => 'SupportConversation', 'subject_id' => $conversation->id,
            'before' => $before === null ? null : ['status' => $before],
            'after' => ['status' => $conversation->status, 'version' => $conversation->version, 'assigned_admin_id' => $conversation->assigned_admin_id],
        ]);
    }
}
