<?php

return [
    'navigation' => ['sports' => 'Sports', 'copy-staking' => 'Copy staking', 'wallet' => 'Wallet', 'how-it-works' => 'How it works', 'about' => 'About'],
    'footer' => ['help' => 'Help centre', 'contact' => 'Contact', 'responsible-play' => 'Responsible play', 'terms' => 'Terms of use', 'privacy' => 'Privacy policy', 'cookies' => 'Cookie policy', 'verification' => 'KYC & verification', 'payments' => 'Payments & withdrawals'],
    'pages' => [
        'sports' => [
            'title' => 'Sports', 'eyebrow' => 'THE FIELD IS YOURS / 01', 'heading' => ['KNOW THE GAME.', 'MAKE YOUR PLAY.'],
            'description' => 'From the field to the court. Explore the available games, compare the odds and keep your picks in view from kick-off to the final score.',
            'visual' => 'sports', 'action' => ['Explore available games', '/app#sports'],
            'sections' => [
                ['title' => 'Find your fixture', 'text' => 'Browse the sports and competitions currently published on EDGE. Each event shows its participants, start time, available odds and status. The fixture list changes as administrators publish and update games.', 'points' => ['Open games accept stakes before their scheduled start.', 'Live, suspended, finished and void games do not accept new stakes.']],
                ['title' => 'One pick. Or a bigger picture.', 'text' => 'A single stake follows one selection. A multiple combines selections from different games into one stake. Review the amount and potential return in your slip before confirming.', 'points' => ['Decimal odds show the total return multiplier, including your stake.', 'Accepted stakes keep the odds recorded when they were placed.', 'If a quote changes before submission, refresh and review the new odds.']],
                ['title' => 'The final score tells the story', 'text' => 'Administrators enter final scores after games end. EDGE uses the recorded outcome to settle accepted stakes and credit winning returns. A void single is refunded; a void selection in a multiple contributes a multiplier of 1.00.'],
                ['title' => 'Keep every result in view', 'text' => 'My stakes shows pending and settled selections. Your wallet history records the associated movements, so you can follow both the game and its effect on your balance.', 'link' => ['Understand settlement', '/how-it-works#settlement']],
            ],
        ],
        'copy-staking' => [
            'title' => 'Copy staking', 'eyebrow' => 'A SHARED EDGE / 02', 'heading' => ['FOLLOW THE PICKS.', 'SEE EVERY MOVE.'],
            'description' => 'Allocate funds to a strategy and follow its future published picks. See how each settled game changes your capital, with the master’s results underneath your chart.',
            'visual' => 'copy', 'action' => ['Explore copy strategies', '/app#copy'],
            'sections' => [
                ['title' => 'Choose a strategy', 'text' => 'Review the strategy description, minimum allocation and percentage used for each copied pick. These are administrator-managed sports strategies. Their future results are uncertain; a displayed risk label is not a promise of safety.'],
                ['title' => 'Allocate from your wallet', 'text' => 'Move an amount from your available wallet balance into a copy position. That allocation is tracked separately. An active position copies future picks published for its strategy; it does not retrospectively copy old games.'],
                ['title' => 'A chart that follows your capital', 'text' => 'Your chart starts with the allocation. Settled wins add net profit; losses subtract the copied stake. Pending games leave the chart unchanged. Refunded games leave capital unchanged. The teams, result and net movement appear in the game history beneath it.', 'points' => ['Chart points can be explored with a pointer, touch or keyboard.', 'Illustrative examples on this website are not a strategy performance record.']],
                ['title' => 'Pause. Review. Return funds.', 'text' => 'Pause a position to stop copying new picks. Existing copied stakes still settle. A position with unsettled games must wait before it can close; once eligible, closing returns its remaining funds to your wallet.', 'link' => ['Open your copy positions', '/app#copy']],
            ],
        ],
        'wallet' => [
            'title' => 'Your wallet', 'eyebrow' => 'EVERY MOVE, ACCOUNTED FOR / 03', 'heading' => ['YOUR FUNDS.', 'IN FULL VIEW.'],
            'description' => 'One account for deposits, stakes, settled returns and withdrawal requests. Follow the status of your funds without losing sight of the next step.',
            'visual' => 'wallet', 'action' => ['Open your wallet', '/app#wallet'],
            'sections' => [
                ['title' => 'Fund your next move', 'text' => 'Choose a payment method currently enabled in your wallet. Card payments use Stripe Checkout when available. Manual methods display the payment image, name and instructions set by the administrator. Submit your payment reference after following those instructions.'],
                ['title' => 'Understand your balances', 'text' => 'Your available balance is the amount you can use for a new stake or allocation. Funds committed to stakes, copy positions or pending withdrawals are tracked separately. A payment reference or a successful redirect alone does not add funds.'],
                ['title' => 'Send between EDGE accounts', 'text' => 'Your wallet shows a permanent 10-digit EDGE account number. Share it to receive funds, or enter another user’s number to send. Review the recipient and dollar amount, then confirm with your current password. Sending requires approved KYC. Transfers have no platform fee, start at $1 and complete immediately; completed transfers cannot be cancelled. These numbers are internal wallet identifiers, not bank accounts.'],
                ['title' => 'Credit codes, made simple', 'text' => 'If you receive a promotional code, enter its 16 letters and numbers in your wallet. A valid, unused code credits its assigned amount once. Credited funds can be staked or withdrawn, subject to approved KYC, the withdrawal minimum and payout review.'],
                ['title' => 'Withdraw with a clear trail', 'text' => 'Complete verification, choose an available withdrawal method, enter the required recipient details and review the amount. Funds are reserved while the administrator reviews your request. A rejected request returns the reserved funds.', 'link' => ['Read the payment guide', '/payments']],
            ],
        ],
        'how-it-works' => [
            'title' => 'How it works', 'eyebrow' => 'THE EDGE PLAYBOOK / 04', 'heading' => ['GET SET.', 'MAKE YOUR MOVE.'],
            'description' => 'From your first sign-in to your first settled result. Here is how your account, wallet and picks work together.',
            'visual' => 'steps', 'action' => ['Create your account', '/app?auth=register#sports'],
            'sections' => [
                ['title' => 'Start with a verified email', 'text' => 'Create an account with your name, email and a password of at least 12 characters including letters and numbers. Enter the six-digit code sent to your inbox to finish sign-up. Password login also requires an email code.', 'points' => ['Codes expire after 10 minutes and allow five attempts.', 'You can request another code after 60 seconds; the new code replaces the old one.']],
                ['title' => 'Fund your wallet', 'text' => 'Open your wallet and choose an available deposit method. Card deposits credit after confirmed Stripe payment. Manual deposits credit after administrator verification. Your new account begins with a zero balance.'],
                ['title' => 'Choose your approach', 'text' => 'Make your own sports selections or fund a copy staking position. Review the amount, odds or strategy settings before confirming. Both approaches can lose funds; returns are never guaranteed.', 'link' => ['Compare copy staking', '/copy-staking']],
                ['id' => 'settlement', 'title' => 'Follow settlement', 'text' => 'After the administrator records a final score, EDGE determines the outcome and settles the affected stakes. Winning returns credit the wallet; copied results update the position. A losing stake reduces the funds committed to that game.'],
                ['title' => 'Verify before withdrawing', 'text' => 'Submit the identity details and documents requested for your account. An administrator must approve KYC before you can withdraw. Payout requests reserve the requested funds and remain subject to review.', 'link' => ['Prepare your verification', '/verification']],
            ],
        ],
        'about' => [
            'title' => 'About EDGE', 'eyebrow' => 'YOUR GAME. YOUR EDGE. / 05', 'heading' => ['BUILT AROUND', 'THE GAME.'],
            'description' => 'EDGE brings sports selections, copy staking and wallet activity into one place. A clear view of every pick, every result and every movement of your funds.',
            'visual' => 'brand', 'action' => ['Explore the platform', '/app#sports'],
            'sections' => [
                ['title' => 'A place to follow the action', 'text' => 'Explore games published by administrators, make your own selections or follow the future picks of a copy strategy. The platform supports sports match-winner markets and shows the odds available for each event.'],
                ['title' => 'Your activity, connected', 'text' => 'Your wallet, stakes, copy chart and transaction history work together. Results are settled from the final scores entered by an administrator. Payment and verification statuses show where a request stands.'],
                ['title' => 'Support inside your account', 'text' => 'The built-in account assistant can answer supported questions using your own account records. Ask to speak with an administrator when you need a person. Support cannot promise outcomes or remove the risks of staking.', 'link' => ['Find help', '/help']],
                ['title' => 'Stay in control', 'text' => 'EDGE is for adults aged 18 and over. Staking involves financial risk, including the loss of your entire stake or copy allocation. Use only funds you can afford to lose and take a break when you need one.', 'link' => ['Read about responsible play', '/responsible-play']],
            ],
        ],
        'help' => [
            'title' => 'Help centre', 'eyebrow' => 'ANSWERS BEFORE YOUR NEXT MOVE', 'heading' => ['A LITTLE HELP.', 'A CLEARER GAME.'],
            'description' => 'Find answers about signing in, funding your wallet, following picks and getting support from an administrator.',
            'action' => ['Open account support', '/app?auth=login#sports'],
            'sections' => [
                ['title' => 'I have not received my email code', 'text' => 'Check that your email is correct, then look in your inbox and spam folder. Codes expire after 10 minutes. Wait 60 seconds before resending; only the latest code works. After five incorrect attempts, request a new code. Never share a verification code.'],
                ['title' => 'My deposit is still pending', 'text' => 'A manual deposit needs administrator verification of the external payment. Check the payment method instructions and your reference. A Stripe return page alone does not confirm payment; your wallet updates after payment confirmation.', 'link' => ['Payment questions', '/payments']],
                ['title' => 'My copy chart has not changed', 'text' => 'Only settled games change the performance chart. Pending picks remain listed without changing the chart. Check that your position is active for future picks; paused positions still settle existing games.'],
                ['title' => 'I cannot request a withdrawal', 'text' => 'Check your KYC approval, available wallet funds, the withdrawal minimum and the available payment methods. Funds in copy positions or pending stakes must become available before you can use them.', 'link' => ['Verification steps', '/verification']],
                ['title' => 'I need to speak with someone', 'text' => 'Sign in and open the support chat. Choose Talk to admin for a handover. Include the relevant request or stake reference and explain what happened. Replies appear in the same private conversation.', 'link' => ['Contact support', '/contact']],
            ],
            'faq' => [
                ['question' => 'Can support change the result of a game?', 'answer' => 'The support assistant cannot settle stakes, change scores or move money. An administrator can review a reported issue through the support inbox.'],
                ['question' => 'Does creating an account give me free funds?', 'answer' => 'No. New accounts start at zero. Deposits need payment confirmation or manual verification. A promotional credit requires a valid, unused administrator-issued code.'],
                ['question' => 'Are arcade games available for paid staking?', 'answer' => 'The arcade titles are previews. Monetary staking is available only for the sports events published on the platform.'],
            ],
        ],
        'contact' => [
            'title' => 'Contact', 'eyebrow' => 'LET’S TALK ABOUT YOUR ACCOUNT', 'heading' => ['YOUR QUESTIONS.', 'OUR NEXT MOVE.'],
            'description' => 'Account support lives inside EDGE. Start a private conversation and keep the relevant details and replies together.',
            'action' => ['Sign in for support', '/app?auth=login#sports'],
            'sections' => [
                ['title' => 'Start an account conversation', 'text' => 'Sign in, open the support chat and choose a topic or type your question. The account assistant can explain your balance, recent payment requests, verification status, stakes and copy positions.'],
                ['title' => 'Ask for an administrator', 'text' => 'Choose Talk to admin in the chat to request a handover. Unsupported questions and requests to change account records also go to the administrator queue. Replies appear in your conversation; no response time is guaranteed.'],
                ['title' => 'Help us find the right activity', 'text' => 'Include the payment request, transaction or stake reference, what you expected, and what you see instead. Keep the conversation focused on your own account.', 'points' => ['Never send your password, email verification code or full card details.', 'Upload identity documents only through the verification page, not support chat.']],
                ['title' => 'Having trouble signing in?', 'text' => 'Use the email address registered on your account, check your spam folder for the code and request a replacement after the resend timer ends. If you used the wrong address, select Use another account on the code screen.', 'link' => ['Visit the help centre', '/help']],
            ],
        ],
        'responsible-play' => [
            'title' => 'Responsible play', 'eyebrow' => 'PLAY SMART. STAY IN CONTROL.', 'heading' => ['THE GAME CAN WAIT.', 'YOU COME FIRST.'],
            'description' => 'Staking should never take priority over your everyday needs. Losses are possible on every pick, including when you copy someone else.',
            'action' => ['Get account support', '/app?auth=login#sports'],
            'sections' => [
                ['title' => 'For adults only', 'text' => 'EDGE is intended for people aged 18 and over. Do not use the platform if you are under 18 or if participation is prohibited where you are. Keep your login details private and away from children.'],
                ['title' => 'Set a personal budget', 'text' => 'Decide what you can afford to lose before placing a stake. Keep money for bills, food, housing and savings separate. Do not borrow to stake or treat potential returns as income you can rely on.'],
                ['title' => 'Do not chase a result', 'text' => 'A previous loss does not make a win more likely. Increasing stakes to recover losses can increase harm. Copy strategies can also lose consecutive games or the entire allocation. Take time away if you feel pressure to continue.'],
                ['title' => 'Pause your next move', 'text' => 'You can pause a copy position to stop future copied picks. Existing stakes still settle. For other account concerns, contact an administrator through support. Pausing a strategy is not an account-wide self-exclusion tool.'],
                ['title' => 'Recognise when you need support', 'text' => 'If staking affects your finances, relationships, sleep or wellbeing, stop and speak to someone you trust or a qualified support professional in your country. Account support can discuss platform activity, but it does not provide clinical advice.'],
            ],
        ],
        'terms' => [
            'title' => 'Terms of use', 'eyebrow' => 'THE PLATFORM RULES', 'heading' => ['KNOW THE RULES.', 'BEFORE THE PLAY.'],
            'description' => 'The conditions for using EDGE accounts, payments, sports stakes and copy positions. Read these alongside the payment and privacy information.',
            'sections' => [
                ['title' => 'Eligibility and your account', 'text' => 'You must be at least 18 and permitted to participate where you are. Provide accurate account and verification information. Keep your password and email codes private. You are responsible for the activity you authorise through your account.'],
                ['title' => 'Placing a stake', 'text' => 'Review the game, selection, odds, amount and potential return before confirming. A stake is accepted only when recorded by the server. Accepted stakes retain their recorded odds. Requests for unavailable games, changed quotes or insufficient funds can be refused.'],
                ['title' => 'Results and void games', 'text' => 'Final scores entered by an administrator determine settlement. A winning return includes the stake according to the accepted decimal odds; a loss forfeits the stake. A void single is refunded. A void leg in a multiple has odds of 1.00; other legs continue to determine the result.'],
                ['title' => 'Copy staking and risk', 'text' => 'Funding an active copy position authorises the strategy’s future published picks according to its settings and available allocation. You can pause future copying. Unsettled stakes must finish before closing a position. No strategy or return is guaranteed.'],
                ['title' => 'Payments and promotional credit', 'text' => 'Card credits depend on payment confirmation; manual credits depend on administrator verification. Withdrawal requests require approved KYC, sufficient available funds, the applicable minimum and administrator review. Promotional codes are single-use and may expire or be revoked before redemption.', 'link' => ['Payment rules', '/payments']],
                ['title' => 'Fair use and questions', 'text' => 'Do not attempt to access another person’s account, manipulate requests, submit false payment evidence or interfere with the service. Report suspected errors with the relevant reference through account support. Platform availability and external payment processing can vary.', 'link' => ['Contact support', '/contact']],
            ],
        ],
        'privacy' => [
            'title' => 'Privacy policy', 'eyebrow' => 'YOUR INFORMATION ON EDGE', 'heading' => ['YOUR ACCOUNT.', 'YOUR INFORMATION.'],
            'description' => 'A plain-language explanation of the information used to operate your account, process requests and support your activity.',
            'sections' => [
                ['title' => 'Information you provide', 'text' => 'Account records include your name, email, password hash and internal EDGE account number. Verification records may include your legal name, date of birth, country, address, document information, identity uploads and any additional fields requested for your account. Payments include amounts, references and recipient details you submit.'],
                ['title' => 'Activity and security records', 'text' => 'EDGE records stakes, accepted odds, results, copy positions, wallet movements, internal transfers, payment requests, promotional redemptions and support conversations. Sessions and server security records can include IP addresses and browser information. These records support account access, settlement, reviews and investigating errors.'],
                ['title' => 'Who can access information', 'text' => 'You can view your own account activity. Authorised administrators can review the records needed for account support, payments and identity checks. Hosting and email services process information needed to operate the website and deliver sign-in codes. The built-in support assistant runs within the platform.'],
                ['title' => 'Card payments and external services', 'text' => 'When enabled, Stripe Checkout collects card payment details on Stripe’s hosted page. EDGE stores the payment references and status needed to credit your wallet; it does not collect your full card number in its own forms. External services apply their own privacy information.', 'link' => ['Stripe privacy information', 'https://stripe.com/privacy']],
                ['title' => 'Protection and retention', 'text' => 'Passwords and email codes are hashed. Pending authentication details, private identity files and support messages are encrypted in storage. Access is restricted by account role. Financial, verification and security records may need to remain available for reviews and transaction history; no automatic deletion period is promised here.'],
                ['title' => 'Questions and account requests', 'text' => 'Use account support to ask about your information, report an error or request a correction or deletion. An administrator will review the request, including any records that need to be retained. Do not send identity documents or passwords in the chat.', 'link' => ['How to contact support', '/contact']],
            ],
        ],
        'cookies' => [
            'title' => 'Cookie policy', 'eyebrow' => 'HOW YOUR BROWSER CONNECTS', 'heading' => ['A SMALL COOKIE.', 'A WORKING ACCOUNT.'],
            'description' => 'EDGE uses browser cookies to keep your session connected and protect account requests. Here is what that means when you use the platform.',
            'sections' => [
                ['title' => 'Your session cookie', 'text' => 'The first-party session cookie connects your browser to its server-side session. It supports signing in, keeping a pending email-code challenge in the same browser and accessing your account. It is marked Secure and HttpOnly on the live site. The configured session lifetime is 120 minutes of inactivity.', 'link' => ['Learn about browser cookies', 'https://ico.org.uk/for-the-public/online/cookies/']],
                ['title' => 'Request protection', 'text' => 'The XSRF-TOKEN cookie supports protection against forged requests. The application also sends a session-specific CSRF token with actions such as verifying a code or requesting a withdrawal. These security mechanisms are part of account operation.'],
                ['title' => 'Other browser storage and services', 'text' => 'The public landing pages do not load advertising or analytics scripts. The separate static platform preview may keep fictional demo activity in local browser storage; that data is not imported into your live wallet. Stripe’s hosted checkout may use its own cookies under its own policy.'],
                ['title' => 'Your browser controls', 'text' => 'You can delete cookies or block them through your browser settings. Deleting session cookies signs you out and can interrupt an email-code challenge. Blocking essential cookies can prevent sign-in and account actions.', 'link' => ['Read the privacy policy', '/privacy']],
            ],
        ],
        'verification' => [
            'title' => 'KYC & verification', 'eyebrow' => 'A CHECK BEFORE YOUR WITHDRAWAL', 'heading' => ['VERIFY YOURSELF.', 'KEEP IT CLEAR.'],
            'description' => 'Administrator-approved identity verification is required before you can request a withdrawal. Your account shows exactly which information is required.',
            'action' => ['Open verification', '/app#verification'],
            'sections' => [
                ['title' => 'Prepare your details', 'text' => 'The standard form asks for your legal name, date of birth, country, residential address, document type and number, an identity document and a selfie. You must be at least 18 and consent to administrator review.', 'points' => ['Identity document: JPG, PNG or PDF, up to 2 MB.', 'Selfie: JPG or PNG, up to 2 MB.', 'Use clear, readable files and accurate information.']],
                ['title' => 'Follow your account’s requirements', 'text' => 'An administrator can assign additional verification layers to individual accounts. Your page shows the reason for verification, required fields and any additional uploads. Requirements can differ between users; complete the form shown on your own account.'],
                ['title' => 'Submit for review', 'text' => 'A submitted verification remains pending until an administrator approves or rejects it. A rejection includes a reason so you can prepare a new submission. Pending documents cannot be silently replaced, and approval is not automatic.'],
                ['title' => 'Keep documents in the right place', 'text' => 'Submit documents only through the signed-in verification page. Files are stored privately and encrypted, with access restricted to the owner and authorised administrators. Email verification codes confirm access to an inbox; they do not replace KYC approval.', 'link' => ['How information is handled', '/privacy']],
            ],
        ],
        'payments' => [
            'title' => 'Payments & withdrawals', 'eyebrow' => 'FROM DEPOSIT TO PAYOUT', 'heading' => ['FOLLOW THE FUNDS.', 'EVERY STEP.'],
            'description' => 'How card deposits, manual payments, wallet credit and withdrawal reviews work on EDGE. All platform amounts are shown in US dollars.',
            'action' => ['Open your wallet', '/app#wallet'],
            'sections' => [
                ['title' => 'Card deposits', 'text' => 'If enabled, choose Stripe in your wallet and continue to hosted checkout. EDGE credits a deposit only after verified payment confirmation. A return URL, screenshot or incomplete checkout is not proof of a paid deposit.'],
                ['title' => 'Manual deposits', 'text' => 'Choose an enabled manual method and follow its current image, name and payment instructions. Submit the payment reference for review. An administrator verifies the external transfer before adding funds. Do not send money to details copied from an unofficial message.'],
                ['title' => 'Requesting a withdrawal', 'text' => 'Your KYC must be approved. Choose an available withdrawal method and complete the recipient fields it requires. Check every detail before confirming. The current deposit and withdrawal minimum is $100, and the amount must be available in your wallet.'],
                ['title' => 'Review and payment status', 'text' => 'A withdrawal request reserves its amount immediately. The administrator reviews and completes the external payout, then records the outcome and reference. If rejected, the reserved funds return to your wallet. The platform does not initiate automatic bank transfers or Stripe withdrawals.'],
                ['title' => 'Transfers to another EDGE user', 'text' => 'Internal transfers use the recipient’s permanent 10-digit EDGE account number. Confirm the displayed name and amount, then enter your current password. Sending requires approved KYC and available funds. The minimum is $1 and the maximum per transfer is $1,000,000, subject to your balance and the recipient wallet limit. There is no platform transfer fee. Funds move immediately, with receipts in both users’ transfer histories; completed transfers cannot be cancelled.'],
                ['title' => 'Timing, costs and questions', 'text' => 'Processing depends on the payment method, external provider and administrator review. EDGE does not promise an instant payout or a fixed completion time. Review provider charges and any conversion costs before paying. If something looks wrong, contact support with the relevant reference.', 'link' => ['Contact support', '/contact']],
            ],
        ],
    ],
];
