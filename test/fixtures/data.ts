import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { encodeAbiParameters, encodeEventTopics, type Hex, type TransactionReceipt } from 'viem';
import { orderBookEventsAbi } from '@somnia-chain/markets-sdk';
import type { Intent } from '../../src/protocol.ts';
import { placementCall } from '../../src/protocol.ts';
import { signPlacement } from '../../src/signing.ts';
import type { ReadEvidence } from '../../src/reconciler.ts';

export const blockHash = `0x${'1'.repeat(64)}` as Hex;
export async function fixture(id = 'test-operation') {
  const account = privateKeyToAccount(generatePrivateKey());
  const intent: Intent = { id, chainId: 50383, owner: '0x00000000000000000000000000000000000000aa', signer: account.address,
    pool: '0x00000000000000000000000000000000000000bb', isBid: true, price: '2000000000000000000000', quantity: '10000000000000000', expireTimestampNs: '1000000000' };
  const fees = { nonce: 7, gas: 10_000_000n, maxFeePerGas: 6_000_000_000n, maxPriorityFeePerGas: 0n };
  const signed = await signPlacement(intent, account, fees);
  return { intent, account, signed, fees };
}
export function evidence(f: Awaited<ReturnType<typeof fixture>>): ReadEvidence {
  const event = orderBookEventsAbi.find(e => e.name === 'OrderPlaced')!;
  const order = { orderId: 123n, isBid: true, owner: f.intent.owner, userData: 0n, price: BigInt(f.intent.price), fullQuantity: BigInt(f.intent.quantity), quantityRemaining: BigInt(f.intent.quantity), expireTimestampNs: BigInt(f.intent.expireTimestampNs) };
  const topics = encodeEventTopics({ abi: orderBookEventsAbi, eventName: 'OrderPlaced', args: { orderId: 123n } });
  const data = encodeAbiParameters(event.inputs.filter(i => !i.indexed), [order]);
  const receipt = { transactionHash: f.signed.hash, from: f.intent.signer, to: f.intent.pool, status: 'success', blockNumber: 100n, blockHash,
    logs: [{ address: f.intent.pool, topics, data, blockNumber: 100n, blockHash, transactionHash: f.signed.hash, transactionIndex: 0, logIndex: 0, removed: false }],
    transactionIndex: 0, contractAddress: null, cumulativeGasUsed: 100n, gasUsed: 100n, effectiveGasPrice: 6_000_000_000n, logsBloom: '0x', type: 'eip1559' } as TransactionReceipt;
  return { transaction: { hash: f.signed.hash, from: f.intent.signer, to: f.intent.pool, input: placementCall(f.intent).data, nonce: f.fees.nonce, chainId: 50383, value: 0n }, receipt, canonicalBlockHash: blockHash, head: 101n };
}
