import { orderBookEventsAbi, type OnchainOrder } from '@somnia-chain/markets-sdk';
import { decodeEventLog, toEventSelector, type Hex, type Log } from 'viem';
import { cancellationCall } from './protocol.ts';
import { OperationStore, type CancelView, type TxState } from './store.ts';
import type { ReadTransport } from './reconciler.ts';

/** Receipt confirmation and order lifecycle are deliberately independent. */
export async function resumeCancel(store:OperationStore,id:string,transport:ReadTransport,confirmations=2):Promise<CancelView> {
  if(!Number.isSafeInteger(confirmations)||confirmations<1) throw new Error('Positive confirmation count required');
  const parent=store.get(id), cancel=store.getCancel(id);
  if(!parent || !cancel) throw new Error('Unknown cancellation');
  if(cancel.state==='CONFLICT') return cancel;
  const states:TxState[]=['SIGNED','UNKNOWN','SUBMITTED','CONFIRMED','REVERTED'];
  const evidence=await transport.read(cancel.hash);
  const {transaction:tx,receipt:rc}=evidence;
  const update=(state:TxState,reason:string)=>{store.transitionCancel(id,states,state,{reason});return store.getCancel(id)!;};
  if(parent.state!=='CONFIRMED' || parent.orderId!==cancel.orderId) return update('UNKNOWN','Parent placement must be reconciled first');
  store.observe(id,{kind:'cancel-receipt',hash:cancel.hash,receiptPresent:!!rc,head:evidence.head.toString()});
  if(!tx || !rc) return cancel.state==='SIGNED'?cancel:update('UNKNOWN','Transaction or receipt not observed');
  const call=cancellationCall(parent.intent.owner,parent.intent.pool,cancel.orderId);
  if(tx.hash!==cancel.hash || rc.transactionHash!==cancel.hash || tx.chainId!==parent.intent.chainId || tx.from.toLowerCase()!==parent.intent.signer.toLowerCase() || rc.from.toLowerCase()!==tx.from.toLowerCase() || tx.to?.toLowerCase()!==call.to.toLowerCase() || rc.to?.toLowerCase()!==call.to.toLowerCase() || tx.input!==call.data || tx.value!==0n || tx.nonce!==cancel.nonce) return update('CONFLICT','Cancel transaction identity mismatch');
  if(rc.blockHash!==evidence.canonicalBlockHash || evidence.head<rc.blockNumber || evidence.head-rc.blockNumber+1n<BigInt(confirmations)) return update('UNKNOWN','Cancel receipt lacks canonical confirmations');
  if(rc.status==='reverted') return update('REVERTED','Cancel reverted; order still requires read-back');
  if(rc.status!=='success') return update('UNKNOWN','Invalid receipt status');
  let matches=0,malformed=false;
  const topic=toEventSelector('OrderCancelled(uint128)');
  for(const log of rc.logs) {
    if(log.address.toLowerCase()!==call.to.toLowerCase() || log.topics[0]!==topic) continue;
    try {const e=decodeEventLog({abi:orderBookEventsAbi,data:log.data,topics:log.topics});if(e.eventName==='OrderCancelled' && e.args.orderId===BigInt(cancel.orderId)) matches++;}
    catch {malformed=true;}
  }
  return malformed||matches!==1?update('UNKNOWN','Receipt success without exact cancellation event'):update('CONFIRMED','Exact OrderCancelled confirmed; remaining/fills require lifecycle read-back');
}

export interface OrderSnapshot {
  blockNumber:bigint; blockHash:Hex; canonicalBlockHash:Hex;
  order:OnchainOrder|null;
  /** Complete canonical pool logs from placement block through blockNumber, inclusive. */
  logs:Log[];
}
export interface OrderReadTransport { snapshot(pool:Hex,orderId:bigint,fromBlock:bigint):Promise<OrderSnapshot> }
export type LifecycleState='OPEN'|'PARTIAL'|'FILLED'|'CANCELLED'|'EXPIRED'|'REMOVED_UNKNOWN'|'CONFLICT'|'UNKNOWN';
export async function inspectOrder(store:OperationStore,id:string,transport:OrderReadTransport) {
  const parent=store.get(id);
  if(!parent || parent.state!=='CONFIRMED' || !parent.orderId) throw new Error('Confirmed placement and exact orderId required');
  const confirmations=store.events(id).filter(e=>e.type==='CONFIRMED');
  const proof=confirmations.at(-1)?.body as {block?:string;blockHash?:Hex}|undefined;
  if(!proof?.block || !proof.blockHash) throw new Error('Placement block proof missing');
  const s=await transport.snapshot(parent.intent.pool,BigInt(parent.orderId),BigInt(proof.block));
  let state:LifecycleState='UNKNOWN',filled=0n,cancelled=false,expired=false,invalid=false,reduced=false;
  const known=new Set(orderBookEventsAbi.map(e=>toEventSelector(e)));
  const seen=new Set<string>();
  let placed=0;
  for(const log of s.logs) {
    if(log.address.toLowerCase()!==parent.intent.pool.toLowerCase()) continue;
    if(log.removed || log.blockNumber===null || log.blockNumber<BigInt(proof.block) || log.blockNumber>s.blockNumber || log.logIndex===null || log.blockHash===null) {invalid=true;continue;}
    const key=`${log.blockHash}:${log.logIndex}`;
    if(seen.has(key)){invalid=true;continue;} seen.add(key);
    try {
      const e=decodeEventLog({abi:orderBookEventsAbi,data:log.data,topics:log.topics});
      const oid=BigInt(parent.orderId);
      if(e.eventName==='OrderPlaced' && e.args.orderId===oid) {
        placed++;
        if(log.transactionHash!==parent.hash || log.blockHash!==proof.blockHash) invalid=true;
      }
      if(e.eventName==='OrderFilled' && (e.args.makerOrderId===oid || e.args.takerOrderId===oid)) filled+=e.args.quantityFilled;
      if(e.eventName==='OrderCancelled' && e.args.orderId===oid) cancelled=true;
      if(e.eventName==='OrderExpired' && e.args.orderId===oid) expired=true;
      if(e.eventName==='OrderReduced' && e.args.orderId===oid) reduced=true;
    } catch {if(log.topics[0] && known.has(log.topics[0])) invalid=true;}
  }
  const full=BigInt(parent.intent.quantity),remaining=s.order?.quantityRemaining??0n;
  if(s.blockHash!==s.canonicalBlockHash || s.blockNumber<BigInt(proof.block)) state='UNKNOWN';
  else if(invalid || placed!==1 || filled>full || (cancelled&&expired) || ((cancelled||expired)&&filled===full)) state='CONFLICT';
  else if(reduced) state='UNKNOWN'; // Outside the first-cycle policy; do not infer missing quantity as fills.
  else if(s.order) {
    const o=s.order;
    if(o.orderId!==BigInt(parent.orderId) || o.owner.toLowerCase()!==parent.intent.owner.toLowerCase() || o.price!==BigInt(parent.intent.price) || o.fullQuantity!==full || o.isBid!==parent.intent.isBid || o.expireTimestampNs!==BigInt(parent.intent.expireTimestampNs) || o.userData!==0n || remaining<=0n || remaining+filled!==full || cancelled || expired) state='CONFLICT';
    else state=filled>0n?'PARTIAL':'OPEN';
  } else if(cancelled) state='CANCELLED';
  else if(expired) state='EXPIRED';
  else state=filled===full?'FILLED':'REMOVED_UNKNOWN';
  const terminalVerified=['CANCELLED','EXPIRED','FILLED'].includes(state);
  const result={id,orderId:parent.orderId,state,filled:filled.toString(),remaining:s.order||terminalVerified?remaining.toString():null,blockNumber:s.blockNumber.toString(),blockHash:s.blockHash,canCancel:state==='OPEN'||state==='PARTIAL',terminalVerified};
  store.observe(id,{kind:'order-lifecycle',...result});
  return result;
}
