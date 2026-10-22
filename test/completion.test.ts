import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {OperationStore} from '../src/store.ts';
import {fixture} from './fixtures/data.ts';
import {signCall,signPlacement} from '../src/signing.ts';
import {cancellationCall} from '../src/protocol.ts';
import {broadcastOnce} from '../src/executor.ts';
import type {CompletionProof} from '../src/completion.ts';
mkdirSync('tmp',{recursive:true});
async function setup(){
  const f=await fixture(),file=resolve(mkdtempSync('tmp/release-test-'),'operations.sqlite'),store=new OperationStore(file,{create:true});
  await store.prepare(f.intent,f.signed);store.transition(f.intent.id,['SIGNED'],'CONFIRMED',{},'123');
  const signed=await signCall(cancellationCall(f.intent.owner,f.intent.pool,'123'),f.account,{...f.fees,nonce:8});
  await store.prepareCancel(f.intent.id,signed);store.transitionCancel(f.intent.id,['SIGNED'],'CONFIRMED',{});
  const proof=():CompletionProof=>({id:f.intent.id,chainId:50383,owner:f.intent.owner,signer:f.intent.signer,pool:f.intent.pool,placeHash:f.signed.hash,cancelHash:signed.hash,orderId:'123',state:'CANCELLED',filled:'0',remaining:'0',position:'0',lockedCollateral:'0',activePools:0,nextNonce:9,pendingNonce:9,blockNumber:'102',blockHash:`0x${'1'.repeat(64)}`,checkedAt:Date.now()});
  const next={...f.intent,id:'next-operation'};
  const nextSigned=await signPlacement(next,f.account,{...f.fees,nonce:9});
  return {f,file,store,proof,next,nextSigned};
}
test('release persists without losing history; next prepare and broadcast require fresh proof',async()=>{
  const {f,file,store,proof,next,nextSigned}=await setup();
  await assert.rejects(store.prepare(next,nextSigned),/UNIQUE/);
  await store.release(f.intent.id,async()=>proof());store.close();
  const reopened=new OperationStore(file);
  try {
    assert.equal(reopened.get(f.intent.id)!.released,true);
    assert.equal(reopened.get(f.intent.id)!.state,'CONFIRMED');
    await assert.rejects(reopened.prepare(next,nextSigned),/Fresh previous/);
    await reopened.prepare(next,nextSigned,async()=>proof());
    let sends=0;
    await assert.rejects(broadcastOnce(reopened,next.id,{async sendRawTransaction(){sends++;return nextSigned.hash;}}),/Fresh previous/);
    assert.equal(sends,0);
    await broadcastOnce(reopened,next.id,{async sendRawTransaction(){sends++;return nextSigned.hash;}},async()=>proof());
    assert.equal(sends,1);
    assert.equal(reopened.events(f.intent.id).filter(e=>e.type==='COMPLETION_RELEASED').length,1);
  } finally {reopened.close();}
});
test('stale, nonzero exposure, pending/external nonce, wrong hash and unconfirmed cancel cannot release',async()=>{
  const {f,store,proof}=await setup();
  try {
    for(const change of [{checkedAt:Date.now()-31_000},{position:'1'},{filled:'1'},{remaining:'1'},{lockedCollateral:'1'},{activePools:1},{pendingNonce:10},{nextNonce:10,pendingNonce:10},{placeHash:`0x${'f'.repeat(64)}`},{state:'FILLED'}]) {
      await assert.rejects(store.release(f.intent.id,async()=>({...proof(),...change}) as CompletionProof),/proof/);
      assert.equal(store.get(f.intent.id)!.released,false);
    }
    store.transitionCancel(f.intent.id,['CONFIRMED'],'UNKNOWN',{});
    await assert.rejects(store.release(f.intent.id,async()=>proof()),/Confirmed/);
  } finally {store.close();}
});
test('RPC failure leaves lock intact and concurrent journal changes defeat release',async()=>{
  const {f,store,proof}=await setup();
  try {
    await assert.rejects(store.release(f.intent.id,async()=>{throw new Error('RPC unavailable');}),/unavailable/);
    await assert.rejects(store.release(f.intent.id,async()=>{store.transitionCancel(f.intent.id,['CONFIRMED'],'UNKNOWN',{});return proof();}),/changed/);
    assert.equal(store.get(f.intent.id)!.released,false);
  } finally {store.close();}
});
test('reorg after release halts signer, including already prepared next place',async()=>{
  const {f,store,proof,next,nextSigned}=await setup();
  try {
    await store.release(f.intent.id,async()=>proof());await store.prepare(next,nextSigned,async()=>proof());
    store.transition(f.intent.id,['CONFIRMED'],'UNKNOWN',{reason:'reorg'});
    let sends=0;
    await assert.rejects(broadcastOnce(store,next.id,{async sendRawTransaction(){sends++;return nextSigned.hash;}},async()=>proof()),/halted/);
    assert.equal(sends,0);
  } finally {store.close();}
});
test('release and event are atomic on write failure',async()=>{
  const {f,file,store,proof}=await setup();store.close();
  const db=new DatabaseSync(file);db.exec("CREATE TRIGGER reject_release BEFORE INSERT ON events WHEN NEW.type='COMPLETION_RELEASED' BEGIN SELECT RAISE(ABORT,'fixture release write failure'); END;");db.close();
  const reopened=new OperationStore(file);
  try {await assert.rejects(reopened.release(f.intent.id,async()=>proof()),/write failure/);assert.equal(reopened.get(f.intent.id)!.released,false);assert.equal(reopened.events(f.intent.id).some(e=>e.type==='COMPLETION_RELEASED'),false);}
  finally {reopened.close();}
});
test('REVERTED never silently frees the signer; changed owner/pool/nonce and old operation IDs are blocked',async()=>{
  const {f,store,proof,next,nextSigned}=await setup();
  try {
    store.transition(f.intent.id,['CONFIRMED'],'REVERTED',{});
    await assert.rejects(store.prepare(next,nextSigned),/UNIQUE/);
    store.transition(f.intent.id,['REVERTED'],'CONFIRMED',{},'123');
    await store.release(f.intent.id,async()=>proof());
    const wrongNonce=await signPlacement(next,f.account,{...f.fees,nonce:10});
    await assert.rejects(store.prepare(next,wrongNonce,async()=>proof()),/nonce/);
    const changed={...next,owner:'0x00000000000000000000000000000000000000cc' as const};
    await assert.rejects(store.prepare(changed,await signPlacement(changed,f.account,{...f.fees,nonce:9}),async()=>proof()),/lane/);
    await store.prepare(f.intent,f.signed);
    assert.throws(()=>store.signedForBroadcast(f.intent.id),/Released/);
  } finally {store.close();}
});
test('concurrent next-operation attempts cannot consume the same signer slot twice',async()=>{
  const {f,store,proof,next,nextSigned}=await setup();
  try {
    await store.release(f.intent.id,async()=>proof());
    const results=await Promise.allSettled([store.prepare(next,nextSigned,async()=>proof()),store.prepare({...next,id:'other-next'},nextSigned,async()=>proof())]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(store.list().filter(r=>!r.released).length,1);
  } finally {store.close();}
});
test('stale completion prevents sending a prepared next operation; cancel reorg halt persists',async()=>{
  const {f,file,store,proof,next,nextSigned}=await setup();
  await store.release(f.intent.id,async()=>proof());await store.prepare(next,nextSigned,async()=>proof());
  let sends=0;
  await assert.rejects(broadcastOnce(store,next.id,{async sendRawTransaction(){sends++;return nextSigned.hash;}},async()=>({...proof(),checkedAt:Date.now()-31_000})),/stale/);
  assert.equal(sends,0);
  store.transitionCancel(f.intent.id,['CONFIRMED'],'UNKNOWN',{reason:'cancel reorg'});store.close();
  const reopened=new OperationStore(file);
  try {await assert.rejects(broadcastOnce(reopened,next.id,{async sendRawTransaction(){sends++;return nextSigned.hash;}},async()=>proof()),/halted/);assert.equal(sends,0);}
  finally {reopened.close();}
});
