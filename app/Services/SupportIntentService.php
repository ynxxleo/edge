<?php

namespace App\Services;

/** A bounded, local question classifier. Answers use the signed-in account only. */
final class SupportIntentService
{
    public const INTENTS = ['balance', 'kyc', 'deposits', 'withdrawals', 'bets', 'copy', 'deposit_help', 'withdrawal_help', 'kyc_help', 'greeting', 'handoff'];

    public function classify(string $body): array
    {
        $normalized = mb_strtolower(trim($body));
        $normalized = str_replace(["’", "‘", "–", "—"], ["'", "'", "-", "-"], $normalized);
        $normalized = preg_replace('/\\s+/u', ' ', $normalized);

        return ['intent' => $this->intent($normalized), 'mode' => 'local'];
    }

    private function mustHandoff(string $body): bool
    {
        return (bool) preg_match('/\b(admin|human|agent|representative|person|fraud|unauthori[sz]ed|stolen|hacked|scam|complaints?|disputes?|chargeback|password|otp|cvv|card number|secret|api key|ignore|instructions?|system prompt|someone else|another|other (?:user|customer|member|account|people)|refund|cancel|delete|change my|update my|increase|reduce|credit|debit|approve|reset|recommend\w*|guarantee\w*|which team|missing|incorrect|not mine|not received|did not receive|didn.t receive)\b/iu', $body);
    }

    private function intent(string $body): string
    {
        if ($this->mustHandoff($body)) {
            return 'handoff';
        }
        if (preg_match('/\b(kyc|verif(?:y|ied|ication)|identity)\b/u', $body)) {
            return preg_match('/\b(how|where)\b/u', $body) ? 'kyc_help' : 'kyc';
        }
        if (preg_match('/\b(withdraw(?:al|als|n|s|ing)?|cash[ -]*out|payouts?)\b/u', $body)) {
            return preg_match('/\b(how|where)\b/u', $body) ? 'withdrawal_help' : 'withdrawals';
        }
        if (preg_match('/\b(copy[ -]*(?:staking|trading)?|master)\b/u', $body)) {
            return 'copy';
        }
        if (preg_match('/\b(deposit(?:s|ed|ing)?|top[ -]*up|fund(?:s|ing)?)\b/u', $body)) {
            return preg_match('/\b(how|where)\b/u', $body) ? 'deposit_help' : 'deposits';
        }
        if (preg_match('/\b(balance|wallet)\b/u', $body)) {
            return 'balance';
        }
        if (preg_match('/\b(bet(?:s|ting)?|stake(?:s)?|results?)\b/u', $body)) {
            return 'bets';
        }
        if (preg_match('/\A\s*(hello|hi|hey|help|good (?:morning|afternoon|evening))[!?.\s]*\z/u', $body)) {
            return 'greeting';
        }

        return 'handoff';
    }
}
