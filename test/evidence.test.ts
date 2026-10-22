import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseTransaction,encodeEventTopics,type Transaction,type TransactionReceipt} from 'viem';
import {fixture,evidence,blockHash} from './fixtures/data.ts';
import {signCall} from '../src/signing.ts';
import {cancellationCall} from '../src/protocol.ts';
import {exportCycle,makeBundle,parseBundle,verifyCycle,type VerifierReads} from '../src/evidence.ts';
import {proveCompletion,type CompletionReads} from '../src/completion.ts';
async function setup(){
  const f=await fixture(),e=evidence(f);
  const signed=await signCall(cancellationCall(f.intent.owner,f.intent.pool,'123'),f.account,{...f.fees,nonce:8});
  const cancelLog={...e.receipt!.logs[0]!,topics:encodeEventTopics({abi:[{type:'event',name:'OrderCancelled',inputs:[{name:'orderId',type:'uint128',indexed:true}]}],eventName:'OrderCancelled',args:{orderId:123n}}) as TransactionReceipt['logs'][number]['topics'],data:'0x' as const,logIndex:1,transactionHash:signed.hash,blockNumber:102n};
  const cr={...e.receipt!,transactionHash:signed.hash,blockNumber:102n,logs:[cancelLog]};
  const ptx={...parseTransaction(f.signed.serialized),value:0n,hash:f.signed.hash,from:f.intent.signer,input:e.transaction!.input} as unknown as Transaction;
  const ctx={...parseTransaction(signed.serialized),value:0n,hash:signed.hash,from:f.intent.signer,input:cancellationCall(f.intent.owner,f.intent.pool,'123').data} as unknown as Transaction;
  const source={status:'COMPLETE',privateKey:'MUST_NOT_EXPORT',signed:f.signed.serialized,place:{intent:f.intent,hash:f.signed.hash,nonce:7,orderId:'123'},cancel:{parentId:f.intent.id,hash:signed.hash,nonce:8,orderId:'123'},placeEvidence:{receipt:e.receipt},cancelEvidence:{receipt:cr}};
  const cycle=exportCycle(JSON.parse(JSON.stringify(source,(_,v)=>typeof v==='bigint'?v.toString():v)));
  const rpc:VerifierReads={async chainId(){return 50383;},async head(){return 110n;},async transaction(h){return h===f.signed.hash?ptx:ctx;},async receipt(h){return h===f.signed.hash?e.receipt!:cr;},async block(n){return {hash:blockHash,number:n};},async nonce(_,b){return b===99n?7:9;},async order(){return null;},async logs(){return [...e.receipt!.logs,cancelLog];}};
  return {f,e,cr,ptx,ctx,source,cycle,rpc};
}
test('export is allowlisted and portable; parser validates integrity and ignores no extra fields',async()=>{
  const {cycle,source}=await setup(),bundle=makeBundle([cycle]);
  const json=JSON.stringify(bundle);assert(!json.includes(source.signed));assert(!json.includes('MUST_NOT_EXPORT'));assert(!json.includes('COMPLETE'));
  assert.deepEqual(parseBundle(JSON.parse(json)),bundle);
  assert.throws(()=>parseBundle({...bundle,verified:true}),/schema fields/);
  const tampered=JSON.parse(json);tampered.cycles[0].archived.place.extra='not allowed';
  assert.throws(()=>parseBundle(tampered),/nested fields/);
});
test('edited hash, unsupported schema and duplicate cycles cannot pass schema validation',async()=>{
  const {cycle}=await setup(),bundle=makeBundle([cycle]);
  assert.throws(()=>parseBundle({...bundle,sha256:'0'.repeat(64)}),/checksum/);
  assert.throws(()=>parseBundle({...bundle,schema:'v2'}),/schema/);
  assert.throws(()=>parseBundle(makeBundle([cycle,cycle])),/Duplicate/);
});
test('independent verifier recomputes both hashes and proves terminal zero-fill lifecycle',async()=>{
  const {cycle,rpc}=await setup();const r=await verifyCycle(cycle,rpc);
  assert.equal(r.status,'VERIFIED');assert.equal(r.state,'CANCELLED');assert.equal(r.hashRecomputed,true);assert.equal(r.duplicatePlace.mined,false);assert.equal(r.duplicatePlace.nonceBefore,7);assert.equal(r.duplicatePlace.nonceAfter,9);
});
test('RPC transaction signature/hash or intent modification fails',async()=>{
  const {cycle,rpc,ptx}=await setup();
  await assert.rejects(verifyCycle({...cycle,intent:{...cycle.intent,quantity:'1'}},rpc),/payload/);
  await assert.rejects(verifyCycle(cycle,{...rpc,async transaction(){return {...ptx,input:'0x'} as Transaction;}}),/hash/);
});
test('archived receipt corruption is caught against fresh RPC even with new bundle checksum',async()=>{
  const {cycle,rpc}=await setup();const bad=structuredClone(cycle);bad.archived.place.gasUsed='123';
  assert.equal(parseBundle(makeBundle([bad])).cycles.length,1);
  await assert.rejects(verifyCycle(bad,rpc),/Archived receipt/);
});
test('receipt reorg or revert is not verified',async()=>{
  const {cycle,rpc}=await setup();
  await assert.rejects(verifyCycle(cycle,{...rpc,async block(n){return {number:n,hash:`0x${'f'.repeat(64)}`};}}),/canonical/);
  await assert.rejects(verifyCycle(cycle,{...rpc,async receipt(h){return {...await rpc.receipt(h),status:'reverted'};}}),/status/);
});
test('absent order without complete event history is not cancellation proof',async()=>{
  const {cycle,rpc}=await setup();
  await assert.rejects(verifyCycle(cycle,{...rpc,async logs(){return [];}}),/lifecycle/);
  await assert.rejects(verifyCycle(cycle,{...rpc,async order(){return {quantityRemaining:1n};}}),/lifecycle/);
});
test('extra nonce defeats duplicate-place claim',async()=>{
  const {cycle,rpc}=await setup();await assert.rejects(verifyCycle(cycle,{...rpc,async nonce(){return 10;}}),/Extra signer/);
});
test('duplicate history logs and RPC unavailability fail closed',async()=>{
  const {cycle,rpc}=await setup();
  await assert.rejects(verifyCycle(cycle,{...rpc,async logs(){const logs=await rpc.logs(cycle.intent.pool,100n,109n);return [...logs,...logs];}}),/Duplicate history/);
  await assert.rejects(verifyCycle(cycle,{...rpc,async transaction(){throw new Error('offline');}}),/offline/);
});
test('completion proof requires independent cycle verification and empty healthy account',async()=>{
  const {cycle,rpc}=await setup();
  const reads:CompletionReads={...rpc,async account(){return {position:0n,lockedCollateral:0n,activePools:0,healthy:true};},async pendingNonce(){return 9;}};
  const proof=await proveCompletion(cycle,reads);assert.equal(proof.nextNonce,9);assert.equal(proof.state,'CANCELLED');
  for(const exposure of [{position:1n},{lockedCollateral:1n},{activePools:1},{healthy:false}])await assert.rejects(proveCompletion(cycle,{...reads,async account(){return {...await reads.account(cycle.intent.pool,cycle.intent.owner,109n),...exposure};}}),/exposure/);
  await assert.rejects(proveCompletion(cycle,{...reads,async pendingNonce(){return 10;}}),/pending/);
  await assert.rejects(proveCompletion(cycle,{...reads,async logs(){return [];}}),/lifecycle/);
});

