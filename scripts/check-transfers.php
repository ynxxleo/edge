<?php

require __DIR__.'/../vendor/autoload.php';

use App\Models\User;
use App\Models\WalletTransfer;
use App\Models\WalletTransaction;
use App\Services\TransferService;
use App\Services\WalletService;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

$worker = ($argv[1] ?? '') === '--worker';
$path = $worker ? $argv[2] : tempnam(sys_get_temp_dir(), 'edge-transfers-');
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$app['env'] = 'testing';
config(['database.default' => 'sqlite', 'database.connections.sqlite.database' => $path, 'cache.default' => 'array', 'hashing.bcrypt.rounds' => 4]);
DB::purge('sqlite');
$service = app(TransferService::class);
$password = 'SyntheticTransferPassword123';
if ($worker) {
    try {
        $sender = User::findOrFail($argv[3]);
        $preview = $service->preview($sender, $argv[4]);
        $service->send($sender, $argv[4], 10000, $preview['confirmation_token'], $password, $argv[5]);
        echo "sent\n";
    } catch (ValidationException) { echo "rejected\n"; }
    exit;
}
try {
    $oldMigrations = array_values(array_filter(glob(__DIR__.'/../database/migrations/*.php'), fn ($file) => !str_contains($file, '2026_10_23_000001')));
    Artisan::call('migrate', ['--force' => true, '--path' => $oldMigrations, '--realpath' => true]);
    $legacyId = DB::table('users')->insertGetId(['name'=>'Existing Member','email'=>'legacy@transfer.test.invalid','password'=>Illuminate\Support\Facades\Hash::make($password),'wallet_balance'=>32100,'created_at'=>now(),'updated_at'=>now()]);
    Artisan::call('migrate', ['--force' => true]);
    $count = 0;
    $check = function ($condition, $message) use (&$count) { if (! $condition) throw new RuntimeException($message); $count++; };
    $reject = function ($action, $message) use ($check) { try {$action();} catch (ValidationException|LogicException) {$check(true, $message);return;} throw new RuntimeException($message); };
    $legacy = User::findOrFail($legacyId);
    $check(preg_match('/^[1-9][0-9]{9}$/', $legacy->internal_account_number) === 1 && $legacy->wallet_balance === 32100, 'Migration assigns existing users numbers without changing their funds');
    $create = fn ($email) => User::create(['name' => 'Synthetic Transfer Person', 'email' => $email, 'password' => $password]);
    $sender = $create('sender@transfer.test.invalid');$recipient = $create('recipient@transfer.test.invalid');$other = $create('other@transfer.test.invalid');
    $approve = function ($user) use ($other) {App\Models\KycSubmission::create(['user_id'=>$user->id,'status'=>'approved','version'=>2,'consented_at'=>now(),'reviewed_by'=>$other->id,'reviewed_at'=>now()]);};
    $check(preg_match('/^[1-9][0-9]{9}$/', $sender->internal_account_number) === 1, 'Account numbers contain ten digits');
    $check($sender->internal_account_number !== $recipient->internal_account_number, 'Numbers are unique');
    $original = $sender->internal_account_number;$sender->name='Updated Name';$sender->save();
    $check($sender->fresh()->internal_account_number === $original, 'Numbers survive profile updates');
    $reject(function () use ($sender) {$sender->internal_account_number='1234567890';$sender->save();}, 'Numbers cannot be changed');$sender->refresh();
    app(WalletService::class)->credit($sender, 50000, 'deposit', 'synthetic-transfer-funds');
    $preview=$service->preview($sender,$recipient->internal_account_number);
    $check(! isset($preview['recipient']['email']) && ! isset($preview['recipient']['id']), 'Lookup exposes no email or database ID');
    $send = fn ($key='transfer-test-001', $amount=10000, $token=null, $pass=null, $target=null) => $service->send($sender, $target ?? $recipient->internal_account_number, $amount, $token ?? $preview['confirmation_token'], $pass ?? $password, $key);
    $reject(fn ()=>$send(), 'Sender KYC is required');$approve($sender);
    $reject(fn ()=>$send(pass:'wrong'), 'Wrong password is rejected');
    $reject(fn ()=>$send(token:'tampered'), 'Tampered confirmation is rejected');
    $reject(fn ()=>$send(amount:0), 'Zero rejected');$reject(fn ()=>$send(amount:-100), 'Negative rejected');
    $reject(fn ()=>$send(amount:99), 'Below minimum rejected');$reject(fn ()=>$send(amount:100000001), 'Above maximum rejected');
    $reject(fn ()=>$send(target:$sender->internal_account_number), 'Self transfers rejected');
    $reject(fn ()=>$send(target:$other->internal_account_number), 'Recipient cannot be changed after preview');
    $approve($other);
    $reject(fn ()=>$service->send($other,$recipient->internal_account_number,10000,$preview['confirmation_token'],$password,'foreign-token'), 'Token cannot move between senders');
    $check(WalletTransfer::count()===0 && $sender->fresh()->wallet_balance===50000, 'All rejections leave balances and transfers unchanged');
    $transfer=$send();
    $check($sender->fresh()->wallet_balance===40000 && $recipient->fresh()->wallet_balance===10000, 'Debit and credit match');
    $check(WalletTransaction::where('type','like','transfer_%')->count()===2, 'Two ledger rows per transfer');
    $check((int) WalletTransaction::where('type','like','transfer_%')->sum('amount')===0, 'Transfer ledger nets to zero');
    $check($send()->id===$transfer->id && $sender->fresh()->wallet_balance===40000, 'Exact retry cannot debit twice');
    $reject(fn ()=>$send(amount:20000), 'A reused key cannot change the amount');
    $reject(fn ()=>$send(key:'insufficient-001',amount:50000), 'Insufficient funds rejected');
    $check(WalletTransfer::count()===1, 'Failed transfer record rolls back');
    $check($transfer->publicData($sender)['direction']==='sent' && $transfer->publicData($recipient)['direction']==='received', 'Both parties see the correct direction');
    $reject(fn ()=>$transfer->update(['amount'=>999]), 'Transfer records cannot change');
    $expire = Illuminate\Support\Facades\Crypt::encryptString(json_encode(['sender_id'=>$sender->id,'recipient_id'=>$recipient->id,'account_number'=>$recipient->internal_account_number,'expires_at'=>now()->subMinute()->timestamp]));
    $reject(fn ()=>$send(key:'expired-preview',token:$expire), 'Expired preview rejected');
    $recipient->wallet_balance=App\Services\StakingRules::MAX_PAYOUT*100;$recipient->save();
    $before=$sender->fresh()->wallet_balance;
    $reject(fn ()=>$send(key:'recipient-cap-001'), 'Recipient overflow rolls back both sides');
    $check($sender->fresh()->wallet_balance===$before && WalletTransfer::count()===1, 'Recipient rejection rolls back the sender debit and receipt');
    $recipient->wallet_balance=10000;$recipient->save();
    $parallel = function ($keys) use ($path, $sender, $recipient) {
        DB::disconnect('sqlite');$processes=[];
        foreach ($keys as $key) {
            $pipes=[];$process=proc_open([PHP_BINARY,__FILE__,'--worker',$path,(string)$sender->id,$recipient->internal_account_number,$key],[1=>['pipe','w'],2=>['pipe','w']],$pipes);
            $processes[]=[$process,$pipes];
        }
        $results=[];
        foreach ($processes as [$process,$pipes]) {$results[]=trim(stream_get_contents($pipes[1]));$errors=stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);if(proc_close($process)!==0)throw new RuntimeException($errors);}
        return $results;
    };
    $check($parallel(['concurrent-same-key','concurrent-same-key'])===['sent','sent'], 'Concurrent duplicate requests both receive a receipt');
    $check(WalletTransfer::count()===2 && $sender->fresh()->wallet_balance===30000, 'Concurrent duplicate only moves funds once');
    User::whereKey($sender->id)->update(['wallet_balance'=>15000]);
    $results=$parallel(['concurrent-spend-a','concurrent-spend-b']);sort($results);
    $check($results===['rejected','sent'], 'Concurrent overspend accepts exactly one transfer');
    $check($sender->fresh()->wallet_balance===5000, 'Concurrent spending cannot overdraw');
    $check(WalletTransfer::count()===3 && (int) WalletTransaction::where('type','like','transfer_%')->sum('amount')===0, 'Concurrent ledger remains balanced');
    echo "PASS: {$count} transfer database and concurrency checks.\n";
} finally {
    DB::disconnect('sqlite');@unlink($path);@unlink($path.'-wal');@unlink($path.'-shm');
}
