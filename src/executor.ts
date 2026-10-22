import { keccak256, type Hex } from 'viem';
import { OperationStore, type RecordView, type CancelView } from './store.ts';
import type { CompletionProof } from './completion.ts';

export interface BroadcastTransport { sendRawTransaction(serialized: Hex): Promise<Hex> }

/** No retries. A failed response leaves the committed identity in UNKNOWN. */
export async function broadcastOnce(store: OperationStore, id: string, transport: BroadcastTransport,checkPrevious?:()=>Promise<CompletionProof>): Promise<RecordView> {
  await store.assertBroadcastReady(id,checkPrevious);
  const signed = store.signedForBroadcast(id);
  if (keccak256(signed.serialized) !== signed.hash) throw new Error('Stored signed payload is corrupt');
  // Must commit before entering the transport. A kill on either side of send is recoverable by hash.
  store.transition(id, ['SIGNED'], 'UNKNOWN', { hash: signed.hash, phase: 'broadcast-attempted' });
  let returned: Hex;
  try { returned = await transport.sendRawTransaction(signed.serialized); }
  catch { return store.get(id)!; } // Do not persist errors that may include raw tx bytes or credentials.
  if (returned !== signed.hash) {
    store.transition(id, ['UNKNOWN'], 'CONFLICT', { reason: 'RPC hash differs from local hash' });
    return store.get(id)!;
  }
  store.transition(id, ['UNKNOWN'], 'SUBMITTED', { hash: returned });
  return store.get(id)!;
}

/** Same durable before-send boundary as place. An unknown cancel is never resent. */
export async function broadcastCancelOnce(store:OperationStore,id:string,transport:BroadcastTransport):Promise<CancelView> {
  const signed=store.signedCancelForBroadcast(id);
  if(keccak256(signed.serialized)!==signed.hash) throw new Error('Stored cancel payload is corrupt');
  store.transitionCancel(id,['SIGNED'],'UNKNOWN',{hash:signed.hash,phase:'broadcast-attempted'});
  let returned:Hex;
  try { returned=await transport.sendRawTransaction(signed.serialized); }
  catch { return store.getCancel(id)!; }
  store.transitionCancel(id,['UNKNOWN'],returned===signed.hash?'SUBMITTED':'CONFLICT',{hash:returned===signed.hash?signed.hash:undefined,reason:returned===signed.hash?'accepted':'RPC hash differs from local hash'});
  return store.getCancel(id)!;
}
