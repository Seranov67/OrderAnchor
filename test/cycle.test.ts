import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {encodeEventTopics,type Hex,type Log} from 'viem';
import {OperationStore} from '../src/store.ts';
import {cancellationCall} from '../src/protocol.ts';
import {signCall} from '../src/signing.ts';
import {broadcastCancelOnce} from '../src/executor.ts';
import {resume} from '../src/reconciler.ts';
import {inspectOrder,resumeCancel,type OrderSnapshot} from '../src/lifecycle.ts';
import {planCancellation} from '../src/cancel-plan.ts';
import type {publicReader} from '../src/read-only.ts';
import {fixture,evidence,blockHash} from './fixtures/data.ts';

mkdirSync('tmp',{recursive:true});
async function setup() {
  const file=resolve(mkdtempSync('tmp/cycle-test-'),'ops.sqlite');
  const f=await fixture();
  const store=new OperationStore(file,{create:true});
  await store.prepare(f.intent,f.signed);
  await resume(store,f.intent.id,{async read(){return evidence(f);}});
  const signed=await signCall(cancellationCall(f.intent.owner,f.intent.pool,'123'),f.account,{...f.fees,nonce:8});
  const snap:OrderSnapshot={blockNumber:101n,blockHash,canonicalBlockHash:blockHash,logs:evidence(f).receipt!.logs,order:{orderId:123n,owner:f.intent.owner,isBid:true,userData:0n,price:BigInt(f.intent.price),fullQuantity:BigInt(f.intent.quantity),quantityRemaining:BigInt(f.intent.quantity),expireTimestampNs:BigInt(f.intent.expireTimestampNs)}};
  return {file,f,store,signed,snap};
}
function terminalLog(eventName:'OrderCancelled'|'OrderExpired',orderId=123n):Log<bigint,number,false> {
  return {address:'0x00000000000000000000000000000000000000bb',topics:encodeEventTopics({abi:[{type:'event',name:eventName,inputs:[{name:'orderId',type:'uint128',indexed:true}]}],eventName,args:{orderId}}) as [Hex,...Hex[]],data:'0x',blockNumber:101n,blockHash,transactionHash:`0x${'2'.repeat(64)}`,transactionIndex:0,logIndex:1,removed:false};
}

test('controlled fixture place -> durable cancel -> confirmed event -> terminal read-back',async()=>{
  const {store,f,signed,snap}=await setup();
  try {
    assert.equal((await inspectOrder(store,f.intent.id,{async snapshot(){return snap;}})).state,'OPEN');
    await store.prepareCancel(f.intent.id,signed);
    let sends=0;
    await broadcastCancelOnce(store,f.intent.id,{async sendRawTransaction(bytes){sends++;assert.equal(bytes,signed.serialized);assert.equal(store.getCancel(f.intent.id)!.state,'UNKNOWN');return signed.hash;}});
    const ev=evidence(f),call=cancellationCall(f.intent.owner,f.intent.pool,'123');
    ev.transaction={...ev.transaction!,hash:signed.hash,input:call.data,nonce:8};
    ev.receipt={...ev.receipt!,transactionHash:signed.hash,logs:[terminalLog('OrderCancelled')]};
    assert.equal((await resumeCancel(store,f.intent.id,{async read(){return ev;}})).state,'CONFIRMED');
    const result=await inspectOrder(store,f.intent.id,{async snapshot(){return {...snap,order:null,logs:[...snap.logs,terminalLog('OrderCancelled')]};}});
    assert.equal(result.state,'CANCELLED');assert.equal(result.terminalVerified,true);assert.equal(result.filled,'0');assert.equal(result.canCancel,false);assert.equal(sends,1);
    assert(!JSON.stringify(store.getCancel(f.intent.id)).includes(signed.serialized));
  } finally {store.close();}
});
test('lost cancel response survives reopen, blocks retry and new root place',async()=>{
  const {store,file,f,signed}=await setup();
  await store.prepareCancel(f.intent.id,signed);
  await broadcastCancelOnce(store,f.intent.id,{async sendRawTransaction(){throw new Error('accepted then timeout');}});store.close();
  const next=new OperationStore(file);
  try {
    assert.equal(next.getCancel(f.intent.id)!.state,'UNKNOWN');
    await assert.rejects(broadcastCancelOnce(next,f.intent.id,{async sendRawTransaction(){throw new Error('must not send');}}),/never-attempted/);
    await assert.rejects(next.prepare({...f.intent,id:'duplicate-place'},f.signed),/UNIQUE/);
  } finally {next.close();}
});
test('cancel is idempotent, rejects changed payload and nonce reuse',async()=>{
  const {store,f,signed}=await setup();
  try {
    await store.prepareCancel(f.intent.id,signed);await store.prepareCancel(f.intent.id,signed);
    assert.equal(store.events(f.intent.id).filter(e=>e.type==='CANCEL_SIGNED_COMMITTED').length,1);
    const other=await signCall(cancellationCall(f.intent.owner,f.intent.pool,'124'),f.account,{...f.fees,nonce:8});
    await assert.rejects(store.prepareCancel(f.intent.id,other),/match/);
    const reuse=await signCall(cancellationCall(f.intent.owner,f.intent.pool,'123'),f.account,f.fees);
    await assert.rejects(store.prepareCancel(f.intent.id,reuse),/nonce/);
  } finally {store.close();}
});
test('missing order without terminal evidence remains unresolved',async()=>{
  const {store,f,snap}=await setup();
  try {const r=await inspectOrder(store,f.intent.id,{async snapshot(){return {...snap,order:null};}});assert.equal(r.state,'REMOVED_UNKNOWN');assert.equal(r.terminalVerified,false);}
  finally {store.close();}
});
test('foreign cancel event does not prove this order cancelled; expiry is distinct',async()=>{
  const {store,f,snap}=await setup();
  try {
    const run=(log:Log)=>inspectOrder(store,f.intent.id,{async snapshot(){return {...snap,order:null,logs:[...snap.logs,log]};}});
    assert.equal((await run(terminalLog('OrderCancelled',999n))).state,'REMOVED_UNKNOWN');
    assert.equal((await run(terminalLog('OrderExpired'))).state,'EXPIRED');
  } finally {store.close();}
});
test('partial fills are accounted for and full fill is not called cancellation',async()=>{
  const {store,f,snap}=await setup();
  try {
    const {encodeAbiParameters}=await import('viem');
    const {orderBookEventsAbi}=await import('@somnia-chain/markets-sdk');
    const qty=BigInt(f.intent.quantity),half=qty/2n;
    const fill=(amount:bigint):Log=>({...terminalLog('OrderCancelled'),topics:encodeEventTopics({abi:orderBookEventsAbi,eventName:'OrderFilled',args:{takerOrderId:999n,makerOrderId:123n}}) as [Hex,...Hex[]],data:encodeAbiParameters([{type:'uint256'},{type:'uint256'},{type:'uint256'},{type:'uint256'}],[amount,0n,qty-amount,BigInt(f.intent.price)])});
    const partial=await inspectOrder(store,f.intent.id,{async snapshot(){return {...snap,order:{...snap.order!,quantityRemaining:half},logs:[...snap.logs,fill(half)]};}});
    assert.equal(partial.state,'PARTIAL');assert.equal(partial.filled,half.toString());
    const cancelled=await inspectOrder(store,f.intent.id,{async snapshot(){return {...snap,order:null,logs:[...snap.logs,fill(half),{...terminalLog('OrderCancelled'),logIndex:2}]};}});
    assert.equal(cancelled.state,'CANCELLED');assert.equal(cancelled.filled,half.toString());
    const filled=await inspectOrder(store,f.intent.id,{async snapshot(){return {...snap,order:null,logs:[...snap.logs,fill(qty)]};}});
    assert.equal(filled.state,'FILLED');
  } finally {store.close();}
});
test('reorg, missing placement anchor and duplicate logs cannot establish terminal state',async()=>{
  const {store,f,snap}=await setup();
  try {
    assert.equal((await inspectOrder(store,f.intent.id,{async snapshot(){return {...snap,canonicalBlockHash:`0x${'f'.repeat(64)}`};}})).state,'UNKNOWN');
    assert.equal((await inspectOrder(store,f.intent.id,{async snapshot(){return {...snap,logs:[]};}})).state,'CONFLICT');
    assert.equal((await inspectOrder(store,f.intent.id,{async snapshot(){return {...snap,logs:[...snap.logs,...snap.logs]};}})).state,'CONFLICT');
  } finally {store.close();}
});
test('cancel receipt requires exact identity, confirmations and matching event',async()=>{
  const {store,f,signed}=await setup();
  try {
    await store.prepareCancel(f.intent.id,signed);
    const ev=evidence(f);
    ev.transaction={...ev.transaction!,hash:signed.hash,input:cancellationCall(f.intent.owner,f.intent.pool,'123').data,nonce:8};
    ev.receipt={...ev.receipt!,transactionHash:signed.hash,logs:[terminalLog('OrderCancelled',999n)]};
    assert.equal((await resumeCancel(store,f.intent.id,{async read(){return ev;}})).state,'UNKNOWN');
    ev.receipt!.logs=[terminalLog('OrderCancelled')];ev.head=100n;
    assert.equal((await resumeCancel(store,f.intent.id,{async read(){return ev;}})).state,'UNKNOWN');
    ev.head=101n;ev.transaction.input='0x';
    assert.equal((await resumeCancel(store,f.intent.id,{async read(){return ev;}})).state,'CONFLICT');
  } finally {store.close();}
});
test('schema v2 migrates without losing placement and durable lock',async()=>{
  const {store,file,f}=await setup();store.close();
  const db=new DatabaseSync(file);db.exec("DROP TABLE cancellations; DROP TABLE completion_releases; DROP TABLE halted_signers; DROP INDEX one_unresolved_signer; ALTER TABLE intents DROP COLUMN released; CREATE UNIQUE INDEX one_unresolved_signer ON intents(chain_id,signer) WHERE state != 'REVERTED'; PRAGMA user_version=2;");db.close();
  const migrated=new OperationStore(file);
  try {assert.equal(migrated.get(f.intent.id)!.state,'CONFIRMED');assert.equal(migrated.getCancel(f.intent.id),undefined);}
  finally {migrated.close();}
});
test('cancel planner only prepares after fresh lifecycle, permissions, nonce and gas checks',async()=>{
  const {store,f,snap}=await setup();
  try {
    let allowed=true,nonce=8,balance=5n*10n**18n,calls=0;
    const rpc={async getChainId(){return 50383;},async readContract(){return allowed;},async getBalance(){return balance;},async getTransactionCount(){return nonce;},async call(){calls++;return {data:'0x'};},async estimateGas(){return 100_000n;},async estimateFeesPerGas(){return {maxFeePerGas:6_000_000_000n,maxPriorityFeePerGas:0n};}} as unknown as ReturnType<typeof publicReader>;
    const receipts={async read(){return evidence(f);}},orders={async snapshot(){return snap;}};
    const result=await planCancellation(store,f.intent.id,receipts,orders,rpc);
    assert.equal(result.signed,false);assert.equal(result.broadcast,false);assert.equal(result.nonce,8);assert.equal(result.call.data,cancellationCall(f.intent.owner,f.intent.pool,'123').data);assert.equal(store.getCancel(f.intent.id),undefined);
    allowed=false;await assert.rejects(planCancellation(store,f.intent.id,receipts,orders,rpc),/permission|nonce/);
    allowed=true;nonce=9;await assert.rejects(planCancellation(store,f.intent.id,receipts,orders,rpc),/nonce/);
    nonce=8;balance=0n;await assert.rejects(planCancellation(store,f.intent.id,receipts,orders,rpc),/ceiling/);
    assert.equal(calls,2);
  } finally {store.close();}
});
