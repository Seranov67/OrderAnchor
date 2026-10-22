import type { SomniaMarkets } from '@somnia-chain/markets-sdk';
import { parseUnits, type Address, type Hex } from 'viem';
import { address, raw } from './protocol.ts';

export interface Geometry { tickSize: string; lotSize: string; minQuantity: string }
/** Reject excess precision before viem parseUnits can round it. */
export function exactUnits(text: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255 || text.length > 300 || !/^\d+(?:\.\d+)?$/.test(text)) throw new Error('Invalid plain decimal');
  if ((text.split('.')[1]?.length ?? 0) > decimals) throw new Error('Excess decimal precision');
  return parseUnits(text, decimals);
}
export function validateGeometry(price: bigint, quantity: bigint, geometry: Geometry): void {
  const tick=raw(geometry.tickSize),lot=raw(geometry.lotSize),minimum=raw(geometry.minQuantity);
  if (price<=0n || quantity<=0n || tick===0n || lot===0n || minimum===0n) throw new Error('Positive price/quantity/market geometry required');
  if (price%tick!==0n) throw new Error('Price is off tick grid');
  if (quantity%lot!==0n) throw new Error('Quantity is off lot grid');
  if (quantity<minimum) throw new Error('Quantity below market minimum');
}

/** Read-only account checks, ready for when public owner/signer addresses exist.
 * These SDK reads are not a block-atomic snapshot or permission to broadcast.
 */
export async function accountPreflight(client: SomniaMarkets['client'], input: {
  owner: Address; signer: Address; pool: Address; marginBank: Address; isBid: boolean; price: bigint; quantity: bigint; geometry: Geometry;
}) {
  const owner=address(input.owner),signer=address(input.signer),pool=address(input.pool),marginBank=address(input.marginBank);
  if(owner===signer)throw new Error('Distinct owner/operator required');
  validateGeometry(input.price,input.quantity,input.geometry);
  const authorized=(selector:Hex)=>client.isOperatorAuthorized({pool,owner,operator:signer,selector});
  const [maximum,margin,position,placeAllowed,cancelAllowed]=await Promise.all([
    client.getMaxPerpOrderSize({pool,marginBank,account:owner,isBid:input.isBid,price:input.price,autoPull:false}),
    client.getMarginAccount(marginBank,owner),client.getPerpPosition({pool,marginBank,account:owner}),
    authorized('0x80054449'),authorized('0xe37b444b'),
  ]);
  return { owner,signer,pool,marginBank,maximum,margin,position,permissions:{placeAllowed,cancelAllowed},
    sizeAccepted:maximum.priceable && maximum.placeable && input.quantity<=maximum.maxQuantity,
    liveSendReady:false,remainingChecks:['Fresh consistent chain reads','Signer gas balance and fee/gas ceiling','Exact call simulation','Durable transaction commit'] };
}
