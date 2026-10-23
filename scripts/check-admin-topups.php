<?php

/** Isolated top-up tests; no production funds or payment providers. */
require __DIR__.'/../vendor/autoload.php';

use App\Models\AdminAudit;
use App\Models\AdminWalletTopup;
use App\Models\User;
use App\Models\WalletTransaction;
use App\Services\AdminTopupService;
use App\Services\StakingRules;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;

$worker=($argv[1]??'')==='--worker';
$path=$worker?$argv[2]:tempnam(sys_get_temp_dir(),'edge-admin-topup-');
$app=require __DIR__.'/../bootstrap/app.php';$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();$app['env']='testing';
config(['database.default'=>'sqlite','database.connections.sqlite.database'=>$path,'cache.default'=>'array','hashing.bcrypt.rounds'=>4]);DB::purge('sqlite');
$password='SyntheticAdminTopup123';$service=app(AdminTopupService::class);
$input=fn ($user,$key) => ['account_number'=>$user->internal_account_number,'amount_cents'=>12345,'reason'=>'Synthetic private correction reason','current_password'=>$password,'confirmed'=>true,'idempotency_key'=>$key];
if($worker){$admin=User::findOrFail($argv[3]);$user=User::findOrFail($argv[4]);$result=$service->credit($admin,$user,$input($user,$argv[5]));echo $result['topup']->id;exit;}
try{
 Artisan::call('migrate',['--force'=>true]);$count=0;
 $check=function($condition,$message)use(&$count){if(!$condition)throw new RuntimeException($message);$count++;};
 $reject=function($action,$message,$status=null)use($check){try{$action();}catch(ValidationException|HttpException|LogicException $error){$check($status===null||($error instanceof HttpException&&$error->getStatusCode()===$status),$message);return;}throw new RuntimeException($message);};
 $create=fn($email)=>User::create(['name'=>'Synthetic Topup User','email'=>$email,'password'=>$password]);
 $admin=$create('admin@topup.test.invalid');$admin->is_admin=true;$admin->save();$user=$create('member@topup.test.invalid');$other=$create('other@topup.test.invalid');
 $payload=$input($user,'synthetic-topup-key-001');
 $reject(fn()=>$service->credit($user,$other,$input($other,'non-admin-topup-001')),'Non-admin rejected',403);
 $stale=$admin->fresh();User::whereKey($admin->id)->update(['is_admin'=>false]);$reject(fn()=>$service->credit($stale,$user,$payload),'Demoted admin rejected despite stale model',403);User::whereKey($admin->id)->update(['is_admin'=>true]);$admin->refresh();
 foreach([['amount_cents'=>0],['amount_cents'=>-100],['amount_cents'=>99],['amount_cents'=>100000001],['amount_cents'=>100.5],['reason'=>'  '],['reason'=>"private\nreason"],['confirmed'=>false],['current_password'=>'wrong'],['account_number'=>$other->internal_account_number]]as$change){$reject(fn()=>$service->credit($admin,$user,array_replace($payload,$change)),'Invalid input rejected');}
 $check(AdminWalletTopup::count()===0&&WalletTransaction::count()===0&&$user->fresh()->wallet_balance===0,'Rejections create no financial state');
 $result=$service->credit($admin,$user,$payload);$receipt=$result['topup'];
 $check(!$result['idempotent']&&$user->fresh()->wallet_balance===12345,'Top-up credits exact cents');
 $check($admin->fresh()->wallet_balance===0,'Direct top-up does not debit admin funds');
 $check($receipt->balance_before===0&&$receipt->balance_after===12345,'Receipt preserves balances at credit time');
 $transaction=WalletTransaction::findOrFail($receipt->wallet_transaction_id);
 $check($transaction->type==='admin_topup'&&$transaction->amount===12345,'Distinct user-visible ledger type');
 $check(!str_contains(json_encode($transaction->toArray()),$payload['reason'])&&!str_contains(json_encode($transaction->toArray()),$password),'User ledger omits private reason and password');
 $check(DB::table('admin_wallet_topups')->value('reason')!==$payload['reason']&&$receipt->reason===$payload['reason'],'Reason encrypted in storage');
 $check(AdminAudit::where('action','wallet.admin_topup')->count()===1,'Audit created');
 $check(!str_contains(json_encode(AdminAudit::first()->toArray()),$payload['reason'])&&!str_contains(json_encode(AdminAudit::first()->toArray()),$password),'General audit omits reason and password');
 $repeat=$service->credit($admin,$user,$payload);$check($repeat['idempotent']&&$repeat['topup']->id===$receipt->id&&$user->fresh()->wallet_balance===12345,'Exact retry cannot credit twice');
 $check(AdminAudit::count()===1&&WalletTransaction::count()===1,'Retry duplicates neither ledger nor audit');
 foreach([['amount_cents'=>20000],['reason'=>'Changed topup reason'],['account_number'=>$other->internal_account_number]]as$change){$reject(fn()=>$service->credit($admin,$user,array_replace($payload,$change)),'Changed retry rejected',409);}
 $reject(fn()=>$service->credit($admin,$other,array_replace($payload,['account_number'=>$other->internal_account_number])),'Same key cannot move to another recipient',409);
 $reject(fn()=>$receipt->update(['amount'=>1]),'Receipts immutable');
 $reject(fn()=>$receipt->delete(),'Receipts cannot be deleted');
 User::whereKey($user->id)->update(['wallet_balance'=>StakingRules::MAX_PAYOUT*100]);
 $reject(fn()=>$service->credit($admin,$user,array_replace($payload,['idempotency_key'=>'recipient-limit-key-001'])),'Wallet cap rejected');
 $check(AdminWalletTopup::count()===1&&AdminAudit::count()===1&&WalletTransaction::count()===1,'Failed cap changes no receipts, audits or ledger');
 User::whereKey($user->id)->update(['wallet_balance'=>12345]);
 AdminAudit::creating(fn()=>throw new LogicException('Synthetic audit write failure'));
 $reject(fn()=>$service->credit($admin,$user,array_replace($payload,['idempotency_key'=>'audit-failure-key-001'])),'Audit failure aborts instruction');
 AdminAudit::flushEventListeners();
 $check($user->fresh()->wallet_balance===12345&&AdminWalletTopup::count()===1&&WalletTransaction::count()===1,'Audit failure rolls back balance, receipt and ledger');
 DB::disconnect('sqlite');$workers=[];
 for($i=0;$i<2;$i++){$pipes=[];$process=proc_open([PHP_BINARY,__FILE__,'--worker',$path,(string)$admin->id,(string)$user->id,'concurrent-topup-key-001'],[1=>['pipe','w'],2=>['pipe','w']],$pipes);$workers[]=[$process,$pipes];}
 $results=[];foreach($workers as[$process,$pipes]){$results[]=trim(stream_get_contents($pipes[1]));$errors=stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);if(proc_close($process)!==0)throw new RuntimeException($errors);}
 $check($results[0]===$results[1],'Concurrent duplicates receive same receipt');
 $check($user->fresh()->wallet_balance===24690&&AdminWalletTopup::count()===2&&WalletTransaction::count()===2&&AdminAudit::count()===2,'Concurrent retry credits once with one audit');
 echo "PASS: {$count} admin top-up database and concurrency checks.\n";
}finally{DB::disconnect('sqlite');@unlink($path);@unlink($path.'-wal');@unlink($path.'-shm');}
