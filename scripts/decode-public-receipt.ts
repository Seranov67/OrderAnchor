import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { decodePlaceOrder } from '@somnia-chain/markets-sdk';
import { decodeFunctionData, type Address, type Hex } from 'viem';
import { operatorAbi } from '../src/protocol.ts';
import { publicReader, stringify } from '../src/read-only.ts';

// An already-public Copilot ETH transaction, not a new OrderAnchor trade.
const hash = '0x0651789850cbecf5d55614eee9fa91755fb8d20239e60e6aad0310bd2ae6127a' as Hex;
const market = (JSON.parse(readFileSync('evidence/sdk-market-2026-10-20.json','utf8')) as {market:{poolAddress:Address;baseSymbol:string}}).market;
assert.equal(market.baseSymbol,'ETH');
const rpc = publicReader();assert.equal(await rpc.getChainId(),50383);
const [transaction,receipt] = await Promise.all([rpc.getTransaction({hash}),rpc.getTransactionReceipt({hash})]);
assert.equal(receipt.status,'success');assert.equal(transaction.to?.toLowerCase(),market.poolAddress.toLowerCase());
const call=decodeFunctionData({abi:operatorAbi,data:transaction.input});
assert.equal(call.functionName,'placeOrderFor');
if(call.functionName!=='placeOrderFor')throw new Error('Unexpected selector');
const decoded=decodePlaceOrder(receipt,market.poolAddress);
assert(decoded.fills.length>0,'Expected historical IOC fill events');
const filled=decoded.fills.reduce((sum,x)=>sum+x.quantityFilled,0n);
assert(filled>0n);assert(filled<=call.args[4]);
const report={at:new Date().toISOString(),sdkVersion:'0.32.1',chainId:50383,source:'Public historical Perps Copilot transaction; no new trade',
  transactionHash:hash,pool:market.poolAddress,from:transaction.from,owner:call.args[0],orderType:call.args[6],requestedRaw:call.args[4],filledRaw:filled,
  decoded,receipt,limits:['Single historical decoder integration check, not our signer/permissions/funding readiness','No claim that this historical trade proves the current full lifecycle or recovery scenario']};
writeFileSync('evidence/sdk-receipt-2026-10-20.json',stringify(report)+'\n');
console.log(stringify({ok:true,hash,pool:market.poolAddress,fillEvents:decoded.fills.length,filledRaw:filled,requestedRaw:call.args[4]}));
