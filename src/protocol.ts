// Operator ABI adapted from DreamDEX S.A., MIT. See THIRD_PARTY_NOTICES.md.
import { ORDER_TYPE, contractErrorsAbi } from '@somnia-chain/markets-sdk';
import { encodeFunctionData, getAddress, isAddress, parseAbi, zeroAddress, type Address, type Hex } from 'viem';
import { CHAIN_ID, assertTestnet } from './config.ts';

export const operatorAbi = [...parseAbi([
  'function placeOrderFor(address owner, bool isBid, uint64 userData, uint256 price, uint256 quantity, uint64 expireTimestampNs, uint8 orderType, uint8 selfMatchingOption, address builder, uint96 builderFeeBpsTimes1k) payable returns (bool success, uint128 orderId)',
  'function cancelOrderFor(address owner, uint128 orderId)',
  'function isOperatorAuthorized(address owner, address operator, bytes4 selector) view returns (bool)',
]), ...contractErrorsAbi] as const;

export interface Intent {
  id: string;
  chainId: typeof CHAIN_ID;
  owner: Address;
  signer: Address;
  pool: Address;
  isBid: boolean;
  price: string;
  quantity: string;
  expireTimestampNs: string;
}
export interface Call { to: Address; data: Hex; value: bigint }

export function address(value: string): Address {
  if (!isAddress(value, { strict: false }) || value.toLowerCase() === zeroAddress) throw new Error('Expected nonzero EVM address');
  return getAddress(value.toLowerCase());
}
export function raw(value: string, bits = 256): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new Error('Expected unsigned raw-unit decimal string');
  const n = BigInt(value);
  if (n >= (1n << BigInt(bits))) throw new Error(`Value exceeds uint${bits}`);
  return n;
}
export function normalizeIntent(input: Intent): Intent {
  assertTestnet(input.chainId);
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(input.id)) throw new Error('Invalid operation ID');
  if (typeof input.isBid !== 'boolean') throw new Error('Expected side boolean');
  if (raw(input.price) === 0n || raw(input.quantity) === 0n || raw(input.expireTimestampNs, 64) === 0n) throw new Error('Price, quantity and expiry must be positive');
  const owner = address(input.owner), signer = address(input.signer), pool = address(input.pool);
  if (owner === signer) throw new Error('Operator path requires a distinct owner and signer');
  return { id: input.id, chainId: CHAIN_ID, owner, signer, pool, isBid: input.isBid, price: input.price, quantity: input.quantity, expireTimestampNs: input.expireTimestampNs };
}
export function placementCall(input: Intent): Call {
  const i = normalizeIntent(input);
  return { to: i.pool, value: 0n, data: encodeFunctionData({ abi: operatorAbi, functionName: 'placeOrderFor',
    args: [i.owner, i.isBid, 0n, raw(i.price), raw(i.quantity), raw(i.expireTimestampNs, 64), ORDER_TYPE.POST_ONLY, 0, zeroAddress, 0n] }) };
}
export function cancellationCall(owner: Address, pool: Address, orderId: string): Call {
  if (raw(orderId, 128) === 0n) throw new Error('Order ID must be positive');
  return { to: address(pool), value: 0n, data: encodeFunctionData({ abi: operatorAbi, functionName: 'cancelOrderFor', args: [address(owner), raw(orderId, 128)] }) };
}
