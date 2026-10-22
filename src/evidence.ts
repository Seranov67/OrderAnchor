import {createHash} from 'node:crypto';
import {decodeEventLog,keccak256,recoverTransactionAddress,serializeTransaction,toEventSelector,type Hex,type Transaction,type TransactionReceipt} from 'viem';
import {orderBookEventsAbi} from '@somnia-chain/markets-sdk';
import {normalizeIntent,placementCall,cancellationCall,raw,type Intent} from './protocol.ts';

export function canonical(value:unknown):string {
  if(typeof value==='bigint') return JSON.stringify(value.toString());
  if(Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if(value!==null && typeof value==='object') return `{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  const result=JSON.stringify(value);if(result===undefined) throw new Error('Unsupported JSON value');return result;
}
export const digest=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
function obj(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('Expected object');return v as Record<string,unknown>;}
function str(v:unknown):string{if(typeof v!=='string')throw new Error('Expected string');return v;}
function hash(v:unknown):Hex{const s=str(v);if(!/^0x[0-9a-f]{64}$/i.test(s))throw new Error('Invalid hash');return s.toLowerCase() as Hex;}
function integer(v:unknown):number{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)throw new Error('Invalid integer');return v;}
function fields(v:Record<string,unknown>,keys:string[]){if(Object.keys(v).sort().join(',')!==keys.sort().join(','))throw new Error('Unexpected schema fields');}
const addr=(v:unknown)=>{const s=str(v);if(!/^0x[0-9a-f]{40}$/i.test(s))throw new Error('Invalid address');return s.toLowerCase();};
const dec=(v:unknown)=>{if(typeof v==='bigint')return v.toString();const s=str(v);raw(s);return s;};

/** Allowlist: no signatures, signed bytes, keys, paths, or runtime errors. */
export function receiptProjection(value:unknown) {
  const r=obj(value);
  if(r.status!=='success'&&r.status!=='reverted')throw new Error('Invalid receipt status');
  if(!Array.isArray(r.logs))throw new Error('Receipt logs missing');
  return {transactionHash:hash(r.transactionHash),blockHash:hash(r.blockHash),blockNumber:dec(r.blockNumber),from:addr(r.from),to:addr(r.to),status:r.status,gasUsed:dec(r.gasUsed),effectiveGasPrice:dec(r.effectiveGasPrice),transactionIndex:integer(r.transactionIndex),logs:r.logs.map(value=>{
    const l=obj(value);if(!Array.isArray(l.topics)||!/^0x(?:[a-f0-9]{2})*$/i.test(str(l.data))||l.removed!==false)throw new Error('Invalid log');
    return {address:addr(l.address),topics:l.topics.map(hash),data:str(l.data).toLowerCase(),blockHash:hash(l.blockHash),blockNumber:dec(l.blockNumber),transactionHash:hash(l.transactionHash),transactionIndex:integer(l.transactionIndex),logIndex:integer(l.logIndex),removed:false};
  })};
}
export interface CycleEvidence {intent:Intent;orderId:string;place:{hash:Hex;nonce:number};cancel:{hash:Hex;nonce:number};archived:{place:ReturnType<typeof receiptProjection>;cancel:ReturnType<typeof receiptProjection>}}
export interface EvidenceBundle {schema:'orderanchor-evidence/v1';createdAt:string;cycles:CycleEvidence[];sha256:string}
export function exportCycle(value:unknown):CycleEvidence {
  const r=obj(value),p=obj(r.place),c=obj(r.cancel),i=obj(p.intent);
  const intent=normalizeIntent({id:str(i.id),chainId:integer(i.chainId) as 50383,owner:str(i.owner) as Hex,signer:str(i.signer) as Hex,pool:str(i.pool) as Hex,isBid:i.isBid as boolean,price:str(i.price),quantity:str(i.quantity),expireTimestampNs:str(i.expireTimestampNs)});
  const orderId=dec(p.orderId);if(raw(orderId,128)===0n||c.orderId!==orderId||c.parentId!==intent.id)throw new Error('Order/parent mismatch');
  const result={intent,orderId,place:{hash:hash(p.hash),nonce:integer(p.nonce)},cancel:{hash:hash(c.hash),nonce:integer(c.nonce)},archived:{place:receiptProjection(obj(r.placeEvidence).receipt),cancel:receiptProjection(obj(r.cancelEvidence).receipt)}};
  if(result.place.hash===result.cancel.hash||result.cancel.nonce!==result.place.nonce+1)throw new Error('Invalid cycle nonce/hash');return result;
}
export function makeBundle(cycles:CycleEvidence[]):EvidenceBundle {
  const body={schema:'orderanchor-evidence/v1' as const,createdAt:new Date().toISOString(),cycles};return {...body,sha256:digest(body)};
}
export function parseBundle(value:unknown):EvidenceBundle {
  const r=obj(value);fields(r,['schema','createdAt','cycles','sha256']);
  if(r.schema!=='orderanchor-evidence/v1'||!Array.isArray(r.cycles)||r.cycles.length<1||r.cycles.length>10||!Number.isFinite(Date.parse(str(r.createdAt))))throw new Error('Invalid bundle schema');
  const cycles=r.cycles.map(v=>{
    const c=obj(v);fields(c,['intent','orderId','place','cancel','archived']);
    const i=obj(c.intent);fields(i,['id','chainId','owner','signer','pool','isBid','price','quantity','expireTimestampNs']);
    const p=obj(c.place),x=obj(c.cancel),a=obj(c.archived);fields(p,['hash','nonce']);fields(x,['hash','nonce']);fields(a,['place','cancel']);
    return exportCycle({place:{...p,intent:i,orderId:c.orderId},cancel:{...x,orderId:c.orderId,parentId:i.id},placeEvidence:{receipt:a.place},cancelEvidence:{receipt:a.cancel}});
  });
  const result={schema:r.schema,createdAt:str(r.createdAt),cycles,sha256:str(r.sha256)} as EvidenceBundle;
  if(digest(r.cycles)!==digest(cycles))throw new Error('Noncanonical or unexpected nested fields');
  const body={schema:result.schema,createdAt:result.createdAt,cycles:result.cycles};
  if(digest(body)!==result.sha256)throw new Error('Bundle checksum mismatch or noncanonical data');
  if(new Set(cycles.flatMap(c=>[c.place.hash,c.cancel.hash])).size!==cycles.length*2 || new Set(cycles.map(c=>c.intent.id)).size!==cycles.length)throw new Error('Duplicate cycle/hash');return result;
}

export interface VerifierReads {
  chainId():Promise<number>;
  transaction(hash:Hex):Promise<Transaction>;
  receipt(hash:Hex):Promise<TransactionReceipt>;
  block(number:bigint):Promise<{hash:Hex;number:bigint}>;
  head():Promise<bigint>;
  nonce(address:Hex,block:bigint):Promise<number>;
  order(pool:Hex,id:bigint,block:bigint):Promise<unknown|null>;
  logs(pool:Hex,from:bigint,to:bigint):Promise<TransactionReceipt['logs']>;
}
export class VerificationError extends Error {}
const requireThat=(ok:unknown,message:string)=>{if(!ok)throw new VerificationError(message);};
const topics=new Set(orderBookEventsAbi.map(e=>toEventSelector(e)));
function decode(log:TransactionReceipt['logs'][number]) {
  if(!log.topics[0]||!topics.has(log.topics[0]))return null;
  try{return decodeEventLog({abi:orderBookEventsAbi,topics:log.topics,data:log.data});}
  catch{throw new VerificationError('Malformed known order event');}
}
/** Reconstruct signed EIP-1559 envelope in memory only, recompute hash, recover sender. */
export async function verifyTransaction(tx:Transaction,expected:{hash:Hex;nonce:number},intent:Intent,kind:'place'|'cancel',orderId:string) {
  requireThat(tx.type==='eip1559'&&tx.chainId===50383,'Wrong transaction type/chain');
  const serialized=serializeTransaction({type:'eip1559',chainId:tx.chainId!,nonce:tx.nonce,gas:tx.gas,maxFeePerGas:tx.maxFeePerGas!,maxPriorityFeePerGas:tx.maxPriorityFeePerGas!,to:tx.to!,value:tx.value,data:tx.input,accessList:tx.accessList??[]},{r:tx.r,s:tx.s,yParity:tx.yParity!});
  requireThat(keccak256(serialized)===expected.hash&&tx.hash===expected.hash,'Transaction hash mismatch');
  requireThat((await recoverTransactionAddress({serializedTransaction:serialized})).toLowerCase()===intent.signer.toLowerCase(),'Recovered signer mismatch');
  const call=kind==='place'?placementCall(intent):cancellationCall(intent.owner,intent.pool,orderId);
  requireThat(tx.from.toLowerCase()===intent.signer.toLowerCase()&&tx.to?.toLowerCase()===call.to.toLowerCase()&&tx.input===call.data&&tx.value===0n&&tx.nonce===expected.nonce,'Transaction payload/nonce mismatch');
}
/** Independent from SQLite, journal, executor and cached verified/COMPLETE flags. */
export async function verifyCycle(c:CycleEvidence,rpc:VerifierReads) {
  requireThat(await rpc.chainId()===50383,'Wrong RPC chain');
  const head=await rpc.head();requireThat(head>1n,'Insufficient head');
  const [pt,ct,pr,cr]=await Promise.all([rpc.transaction(c.place.hash),rpc.transaction(c.cancel.hash),rpc.receipt(c.place.hash),rpc.receipt(c.cancel.hash)]);
  await verifyTransaction(pt,c.place,c.intent,'place',c.orderId);await verifyTransaction(ct,c.cancel,c.intent,'cancel',c.orderId);
  for(const [rc,ref,saved] of [[pr,c.place,c.archived.place],[cr,c.cancel,c.archived.cancel]] as const) {
    requireThat(rc.transactionHash===ref.hash&&rc.status==='success'&&rc.from.toLowerCase()===c.intent.signer.toLowerCase()&&rc.to?.toLowerCase()===c.intent.pool.toLowerCase(),'Receipt identity/status mismatch');
    requireThat(head-rc.blockNumber+1n>=2n&&rc.blockHash===(await rpc.block(rc.blockNumber)).hash,'Receipt not canonical/confirmed');
    requireThat(digest(receiptProjection(rc))===digest(saved),'Archived receipt differs from fresh RPC');
    for(const log of rc.logs) requireThat(log.blockHash===rc.blockHash&&log.blockNumber===rc.blockNumber&&log.transactionHash===rc.transactionHash&&log.transactionIndex===rc.transactionIndex&&!log.removed,'Receipt log identity mismatch');
  }
  requireThat(pr.blockNumber>0n&&cr.blockNumber>=pr.blockNumber&&c.cancel.nonce===c.place.nonce+1,'Invalid cycle ordering');
  const placed=pr.logs.filter(l=>l.address.toLowerCase()===c.intent.pool.toLowerCase()).flatMap(l=>{
    const e=decode(l);return e?.eventName==='OrderPlaced'?[e.args]:[];
  });
  requireThat(placed.length===1,'Expected exactly one placement event');const o=placed[0]!.placedOrder;
  requireThat(o.orderId===BigInt(c.orderId)&&o.owner.toLowerCase()===c.intent.owner.toLowerCase()&&o.price===BigInt(c.intent.price)&&o.fullQuantity===BigInt(c.intent.quantity)&&o.quantityRemaining===o.fullQuantity&&o.isBid===c.intent.isBid&&o.userData===0n&&o.expireTimestampNs===BigInt(c.intent.expireTimestampNs),'OrderPlaced differs from intent');
  const cancelled=cr.logs.filter(l=>l.address.toLowerCase()===c.intent.pool.toLowerCase()).flatMap(l=>{const e=decode(l);return e?.eventName==='OrderCancelled'&&e.args.orderId===BigInt(c.orderId)?[e]:[];});
  requireThat(cancelled.length===1,'Exact cancellation event missing');
  const snapshot=head-1n;
  const snapshotBlock=await rpc.block(snapshot);
  const [order,logs,beforeNonce,afterNonce]=await Promise.all([rpc.order(c.intent.pool,BigInt(c.orderId),snapshot),rpc.logs(c.intent.pool,pr.blockNumber,snapshot),rpc.nonce(c.intent.signer,pr.blockNumber-1n),rpc.nonce(c.intent.signer,cr.blockNumber)]);
  let fills=0n,places=0,cancels=0;const seen=new Set<string>();
  for(const log of logs) {
    requireThat(log.address.toLowerCase()===c.intent.pool.toLowerCase()&&!log.removed&&log.blockNumber>=pr.blockNumber&&log.blockNumber<=snapshot,'Invalid history log');
    const key=`${log.blockHash}:${log.logIndex}`;requireThat(!seen.has(key),'Duplicate history log');seen.add(key);
    const e=decode(log);if(!e)continue;
    if(e.eventName==='OrderPlaced'&&e.args.orderId===BigInt(c.orderId)){places++;requireThat(log.transactionHash===c.place.hash&&log.blockHash===pr.blockHash,'History placement mismatch');}
    if(e.eventName==='OrderCancelled'&&e.args.orderId===BigInt(c.orderId)){cancels++;requireThat(log.transactionHash===c.cancel.hash&&log.blockHash===cr.blockHash,'History cancellation mismatch');}
    if(e.eventName==='OrderFilled'&&(e.args.makerOrderId===BigInt(c.orderId)||e.args.takerOrderId===BigInt(c.orderId)))fills+=e.args.quantityFilled;
    if(e.eventName==='OrderReduced'&&e.args.orderId===BigInt(c.orderId))throw new Error('Unexpected order reduction');
  }
  requireThat(order===null&&places===1&&cancels===1&&fills===0n,'Cancelled zero-fill lifecycle not established');
  requireThat(beforeNonce===c.place.nonce&&afterNonce===c.cancel.nonce+1&&afterNonce-beforeNonce===2,'Extra signer transaction/duplicate place in cycle interval');
  // Re-read anchors after history/nonces so a concurrent reorg cannot pass a stale receipt.
  requireThat((await rpc.block(pr.blockNumber)).hash===pr.blockHash&&(await rpc.block(cr.blockNumber)).hash===cr.blockHash&&(await rpc.block(snapshot)).hash===snapshotBlock.hash,'Canonical anchors changed');
  return {id:c.intent.id,status:'VERIFIED' as const,placeHash:c.place.hash,cancelHash:c.cancel.hash,orderId:c.orderId,hashRecomputed:true,signerRecovered:true,archivedReceiptsMatch:true,state:'CANCELLED',filled:'0',remaining:'0',duplicatePlace:{mined:false,fromBlock:pr.blockNumber.toString(),throughBlock:cr.blockNumber.toString(),nonceBefore:beforeNonce,nonceAfter:afterNonce,scope:'This signer, inclusive place-to-cancel block interval; does not prove network send-attempt count'},snapshot:{blockNumber:snapshot.toString(),blockHash:snapshotBlock.hash},gasCostRaw:(pr.gasUsed*pr.effectiveGasPrice+cr.gasUsed*cr.effectiveGasPrice).toString()};
}
