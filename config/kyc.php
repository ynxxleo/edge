<?php

return [
    // Approval is required for new withdrawal requests; existing requests retain their history.
    'withdrawal_requires_approval' => true,
    'disk' => 'kyc',
    'max_file_kilobytes' => 2048,
    // Keep multipart requests below PHP's local 8MB post limit, including form overhead.
    'max_total_file_kilobytes' => 6144,
];
