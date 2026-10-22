import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {privateKeyToAccount} from 'viem/accounts';
import type {Hex} from 'viem';
import {OperationStore} from '../src/store.ts';
import {signCall,signPlacement} from '../src/signing.ts';
import {placementCall,type Intent} from '../src/protocol.ts';
import {broadcastOnce,broadcastCancelOnce} from '../src/executor.ts';
import {resume} from '../src/reconciler.ts';
import {inspectOrder,resumeCancel} from '../src/lifecycle.ts';
import {planCancellation} from '../src/cancel-plan.ts';
import {publicReader,readTransport,orderReadTransport,readOnlyMarkets,stringify} from '../src/read-only.ts';

// One explicitly authorized testnet cycle; key supplied only via private stdin.
const mode=process.argv[2];
if(!['--execute-testnet-cycle','--fault-child','--recover-cancel'].includes(mode??'')) throw new Error('Explicit execution flag required');
const fault=mode==='--fault-child',recover=mode==='--recover-cancel',crashCycle=fault||recover;
let secret='';for await(const chunk of process.stdin) secret+=chunk;
const account=privateKeyToAccount(secret.trim() as Hex);secret='';
if(account.address.toLowerCase()!=='0xa50a0cc153807a86e55a613f327be6752cdeb389') throw new Error('Wrong signer');
const rpc=publicReader(),receipts=readTransport(),orders=orderReadTransport();
const evidencePath=crashCycle?'evidence/crash-cycle-2026-10-22.json':'evidence/live-cycle-2026-10-22.json';
const dbPath=crashCycle?'secrets/orderanchor-bot-user/crash-cycle.sqlite':'secrets/orderanchor-bot-user/first-cycle.sqlite';
const report:Record<string,unknown>=recover?JSON.parse(readFileSync(evidencePath,'utf8')):{at:new Date().toISOString(),chainId:50383,signer:account.address};
const save=()=>writeFileSync(evidencePath,stringify(report)+'\n');
if(!recover && existsSync(dbPath)) throw new Error('Existing cycle database: resume only; no new placement');
if(recover && !existsSync(dbPath)) throw new Error('Recovery database missing; never create a new place');
const pre=recover?report.preflight:JSON.parse(readFileSync('evidence/first-operation-preflight-2026-10-22.json','utf8'));
if(!recover && (pre.status!=='SIMULATED_NOT_SIGNED' || Date.now()-Date.parse(pre.at)>60_000)) throw new Error('Fresh successful preflight required');
const intent={...pre.intent,id:crashCycle?'orderanchor-crash-20261022':pre.intent.id} as Intent;
if(intent.chainId!==50383 || intent.owner.toLowerCase()!=='0xcf0a0858c6f6e81e553e580af6617aa128e96533' || intent.signer.toLowerCase()!==account.address.toLowerCase() || BigInt(intent.price)*BigInt(intent.quantity)/10n**18n>15n*10n**18n) throw new Error('Intent outside authorized small test policy');
const store=new OperationStore(dbPath,{create:!recover});
let phase='preflight';
async function waitConfirmed(cancel=false) {
  for(let n=0;n<30;n++) {
    const result=cancel?await resumeCancel(store,intent.id,receipts):await resume(store,intent.id,receipts);
    report[cancel?'cancel':'place']=result;save();
    if(result.state==='CONFIRMED') return;
    if(result.state==='REVERTED'||result.state==='CONFLICT') throw new Error('Transaction needs intervention');
    await new Promise(r=>setTimeout(r,1000));
  }
  throw new Error('Confirmation timeout; saved hash must be resumed without resend');
}
try {
  if(await rpc.getChainId()!==50383) throw new Error('Wrong chain');
  const sender={sendRawTransaction:(serialized:Hex)=>rpc.sendRawTransaction({serializedTransaction:serialized})};
  if(!recover) {
  const [latest,pending]=await Promise.all([rpc.getTransactionCount({address:account.address,blockTag:'latest'}),rpc.getTransactionCount({address:account.address,blockTag:'pending'})]);
  if(latest!==pending || latest!==pre.nonceLatest) throw new Error('Signer nonce changed');
  const call=placementCall(intent);
  await rpc.call({account:account.address,...call});
  const gas=await rpc.estimateGas({account:account.address,...call}),fees=await rpc.estimateFeesPerGas();
  const gasLimit=(gas*125n+99n)/100n;
  if(gasLimit*fees.maxFeePerGas>100_000_000_000_000_000n || await rpc.getBalance({address:account.address})<200_000_000_000_000_000n) throw new Error('Insufficient gas reserve or fee ceiling exceeded');
  report.preflight=pre;report.placeGas={gas:gasLimit,...fees};save();
  phase='place';
  await store.prepare(intent,await signPlacement(intent,account,{nonce:latest,gas:gasLimit,...fees}));
  report.place=store.get(intent.id);save();console.log(stringify({phase:'place-signed-committed',hash:store.get(intent.id)!.hash}));
  if(fault) {
    report.childPid=process.pid;report.placeSendAttempts=0;save();
    await broadcastOnce(store,intent.id,{async sendRawTransaction(serialized) {
      report.placeSendAttempts=Number(report.placeSendAttempts)+1;save();
      const accepted=await sender.sendRawTransaction(serialized);
      if(accepted!==store.get(intent.id)!.hash) throw new Error('Accepted hash mismatch');
      // Fault harness observes acceptance, but never returns it to the executor.
      report.fault={kind:'accepted-response-hidden-then-SIGKILL',acceptedHash:accepted,executorState:store.get(intent.id)!.state,at:new Date().toISOString()};
      report.place=store.get(intent.id);report.status='CHILD_KILL_REQUESTED';save();
      console.log(stringify({phase:'RPC-accepted-response-hidden',hash:accepted,pid:process.pid,state:store.get(intent.id)!.state}));
      process.kill(process.pid,'SIGKILL');
      await new Promise<never>(()=>{});
      return accepted;
    }});
    throw new Error('Fault child unexpectedly returned');
  }
  await broadcastOnce(store,intent.id,sender);
  } else {
    phase='recovery';
    const persisted=store.get(intent.id);
    if(!persisted || persisted.hash!==(report.fault as {acceptedHash?:string})?.acceptedHash || report.placeSendAttempts!==1) throw new Error('Recovery identity/attempt proof missing');
    report.restart={pid:process.pid,priorPid:report.childPid,persistedState:persisted.state,persistedHash:persisted.hash,placeBroadcastsDuringRecovery:0};save();
    console.log(stringify({phase:'reopened-existing-database',state:persisted.state,hash:persisted.hash,pid:process.pid}));
  }
  await waitConfirmed();
  report.placeEvidence=await receipts.read(store.get(intent.id)!.hash);save();
  console.log(stringify({phase:'place-confirmed',placement:store.get(intent.id)}));
  phase='inspect-order';
  const placed=await inspectOrder(store,intent.id,orders);report.afterPlace=placed;save();
  if(placed.canCancel) {
    phase='cancel-plan';
    const plan=await planCancellation(store,intent.id,receipts,orders,rpc);report.cancelPlan=plan;save();
    phase='cancel';
    await store.prepareCancel(intent.id,await signCall(plan.call,account,{nonce:plan.nonce,gas:plan.gas,maxFeePerGas:plan.maxFeePerGas,maxPriorityFeePerGas:plan.maxPriorityFeePerGas}));
    report.cancel=store.getCancel(intent.id);save();console.log(stringify({phase:'cancel-signed-committed',hash:store.getCancel(intent.id)!.hash}));
    await broadcastCancelOnce(store,intent.id,sender);await waitConfirmed(true);
    report.cancelEvidence=await receipts.read(store.getCancel(intent.id)!.hash);save();
  }
  phase='final-read';
  report.finalOrder=await inspectOrder(store,intent.id,orders);
  const sdk=readOnlyMarkets();
  try {report.finalPosition=await sdk.client.getPerpPosition({pool:intent.pool,marginBank:pre.market.market.marginBank,account:intent.owner});report.finalMargin=await sdk.client.getMarginAccount(pre.market.market.marginBank,intent.owner);}
  finally {await sdk.close();}
  report.finalSTTRaw=await rpc.getBalance({address:account.address});
  report.events=store.events(intent.id);
  if(recover) {
    const [latest,pending]=await Promise.all([rpc.getTransactionCount({address:account.address,blockTag:'latest'}),rpc.getTransactionCount({address:account.address,blockTag:'pending'})]);
    const record=store.get(intent.id)!;
    report.duplicateCheck={placeAttemptEvents:store.events(intent.id).filter(e=>e.type==='UNKNOWN' && (e.body as {phase?:string}).phase==='broadcast-attempted').length,latestNonce:latest,pendingNonce:pending,expectedAfterPlaceCancel:record.nonce+2,placeHashUnchanged:record.hash===(report.fault as {acceptedHash:string}).acceptedHash};
    if(latest!==record.nonce+2 || pending!==latest || (report.duplicateCheck as {placeAttemptEvents:number}).placeAttemptEvents!==1) throw new Error('Duplicate/nonce invariant not established');
  }
  report.status='COMPLETE';save();
  console.log(stringify({status:report.status,place:store.get(intent.id),cancel:store.getCancel(intent.id),finalOrder:report.finalOrder,finalPosition:report.finalPosition,evidencePath}));
} catch {
  report.status='NEEDS_RECONCILIATION';report.phase=phase;report.place=store.get(intent.id);report.cancel=store.getCancel(intent.id);report.events=store.events(intent.id);save();
  console.error(stringify({status:report.status,phase,place:report.place,cancel:report.cancel,evidencePath}));process.exitCode=1;
} finally {store.close();}
