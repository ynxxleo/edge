<?php

return [
    // New wallets use US dollars. The persisted payment settings currency keeps
    // existing wallets in their original denomination until an explicit switch.
    'currency' => 'USD',
    // Configure verified bank details here or via the environment before accepting deposits.
    'deposit_instructions' => env('STAKING_DEPOSIT_INSTRUCTIONS', 'Contact the platform administrator for verified bank transfer instructions. Submit the transfer reference for review. Your wallet is credited only after approval.'),
];
