import { keccak256, parseTransaction, recoverTransactionAddress, type Hex, type LocalAccount, type TransactionSerialized } from 'viem';
import { CHAIN_ID } from './config.ts';
import { placementCall, normalizeIntent, type Call, type Intent } from './protocol.ts';

export interface Fees { nonce: number; gas: bigint; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }
export interface Signed { hash: Hex; serialized: TransactionSerialized }

/** Fully local: all fields are explicit; no wallet client, nonce manager or RPC. */
export async function signCall(call: Call, account: LocalAccount, fees: Fees): Promise<Signed> {
  if (!Number.isSafeInteger(fees.nonce) || fees.nonce < 0 || fees.gas <= 0n || fees.maxFeePerGas <= 0n || fees.maxPriorityFeePerGas < 0n || fees.maxPriorityFeePerGas > fees.maxFeePerGas) throw new Error('Invalid explicit transaction fees/nonce');
  if (!account.signTransaction) throw new Error('Local transaction signing required');
  const serialized = await account.signTransaction({ type: 'eip1559', chainId: CHAIN_ID,
    to: call.to, data: call.data, value: call.value, ...fees });
  if (!/^0x02(?:[0-9a-f]{2})+$/i.test(serialized)) throw new Error('Signer did not return an EIP-1559 transaction');
  return { serialized: serialized as `0x02${string}`, hash: keccak256(serialized) };
}
export async function signPlacement(intent: Intent, account: LocalAccount, fees: Fees): Promise<Signed> {
  const i = normalizeIntent(intent);
  if (i.signer.toLowerCase() !== account.address.toLowerCase()) throw new Error('Signer does not match intent');
  return signCall(placementCall(i), account, fees);
}
export async function verifySignedCall(call: Call, signer: string, signed: Signed): Promise<number> {
  if (keccak256(signed.serialized) !== signed.hash) throw new Error('Signed hash mismatch');
  const tx = parseTransaction(signed.serialized as TransactionSerialized);
  const from = await recoverTransactionAddress({ serializedTransaction: signed.serialized });
  if (tx.type !== 'eip1559' || tx.chainId !== CHAIN_ID || tx.to?.toLowerCase() !== call.to.toLowerCase() || tx.data !== call.data || (tx.value ?? 0n) !== call.value || from.toLowerCase() !== signer.toLowerCase()) throw new Error('Signed transaction does not match intent');
  if (tx.nonce === undefined || !Number.isSafeInteger(tx.nonce) || tx.nonce < 0) throw new Error('Invalid signed nonce');
  return tx.nonce;
}
