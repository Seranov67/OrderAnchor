import { decodePlaceOrder, orderBookEventsAbi } from '@somnia-chain/markets-sdk';
import { decodeEventLog, toEventSelector, type Hex, type TransactionReceipt } from 'viem';
import { CHAIN_ID } from './config.ts';
import { placementCall } from './protocol.ts';
import { OperationStore, type RecordView } from './store.ts';

export interface ReadEvidence {
  transaction: { hash: Hex; from: string; to: string | null; input: Hex; nonce: number; chainId: number; value: bigint } | null;
  receipt: TransactionReceipt | null;
  canonicalBlockHash: Hex | null;
  head: bigint;
}
export interface ReadTransport { read(hash: Hex): Promise<ReadEvidence> }

/** This interface has no write method; resuming never broadcasts or signs. */
export async function resume(store: OperationStore, id: string, transport: ReadTransport, confirmations = 2): Promise<RecordView> {
  if (!Number.isSafeInteger(confirmations) || confirmations < 1) throw new Error('Positive confirmation count required');
  const record = store.get(id);
  if (!record) throw new Error('Unknown operation');
  if (record.state === 'CONFLICT') return record;
  let evidence: ReadEvidence;
  try { evidence = await transport.read(record.hash); }
  catch { store.observe(id, { outcome: 'read-unavailable' }); throw new Error('Read unavailable; previous state has not been refreshed'); }
  const { transaction: tx, receipt: rc } = evidence;
  const states = ['SIGNED','UNKNOWN','SUBMITTED','CONFIRMED','REVERTED'] as const;
  const unknown = (reason: string) => {
    store.transition(id, [...states], 'UNKNOWN', { reason, hash: record.hash });
    return store.get(id)!;
  };
  store.observe(id, { hash: record.hash, receiptPresent: !!rc, transactionPresent: !!tx, head: evidence.head.toString() });
  if (!rc || !tx) return record.state === 'SIGNED' ? record : unknown('Transaction or receipt not observed');
  const call = placementCall(record.intent);
  if (tx.hash !== record.hash || rc.transactionHash !== record.hash || tx.chainId !== CHAIN_ID || tx.from.toLowerCase() !== record.intent.signer.toLowerCase() || rc.from.toLowerCase() !== tx.from.toLowerCase() || tx.to?.toLowerCase() !== call.to.toLowerCase() || rc.to?.toLowerCase() !== call.to.toLowerCase() || tx.input !== call.data || tx.value !== call.value || tx.nonce !== record.nonce) {
    store.transition(id, [...states], 'CONFLICT', { reason: 'Chain transaction identity differs from signed intent' });
    return store.get(id)!;
  }
  if (rc.blockHash !== evidence.canonicalBlockHash || evidence.head < rc.blockNumber || evidence.head - rc.blockNumber + 1n < BigInt(confirmations)) return unknown('Receipt lacks canonical confirmations');
  if (rc.status !== 'success' && rc.status !== 'reverted') return unknown('Invalid receipt status');
  if (rc.status === 'reverted') {
    store.transition(id, [...states], 'REVERTED', { block: rc.blockNumber.toString(), blockHash: rc.blockHash });
    return store.get(id)!;
  }
  // The SDK decoder skips malformed known logs. Require a fully decoded OrderPlaced,
  // matching the intent, before exposing an order identity from a POST_ONLY receipt.
  let malformedKnownLog = false;
  const knownTopics = new Set(orderBookEventsAbi.map(e => toEventSelector(e)));
  const placed = rc.logs.filter(l => l.address.toLowerCase() === call.to.toLowerCase()).flatMap(l => {
    try {
      const decoded = decodeEventLog({ abi: orderBookEventsAbi, topics: l.topics, data: l.data });
      return decoded.eventName === 'OrderPlaced' ? [decoded.args] : [];
    } catch { if (l.topics[0] && knownTopics.has(l.topics[0])) malformedKnownLog = true; return []; }
  });
  const decoded = decodePlaceOrder(rc, call.to);
  const matching = placed.length === 1 && placed[0]?.placedOrder;
  if (malformedKnownLog || !matching || decoded.orderId === undefined || matching.owner.toLowerCase() !== record.intent.owner.toLowerCase() || matching.price !== BigInt(record.intent.price) || matching.fullQuantity !== BigInt(record.intent.quantity) || matching.quantityRemaining > matching.fullQuantity || matching.userData !== 0n || matching.expireTimestampNs !== BigInt(record.intent.expireTimestampNs) || matching.isBid !== record.intent.isBid || decoded.orderId !== matching.orderId) return unknown('Receipt confirmed; exact resting order not established');
  store.transition(id, [...states], 'CONFIRMED', { block: rc.blockNumber.toString(), blockHash: rc.blockHash, orderId: decoded.orderId.toString(), fillEvents: decoded.fills.length, lifecycle: 'current remaining still requires on-chain read' }, decoded.orderId.toString());
  return store.get(id)!;
}
