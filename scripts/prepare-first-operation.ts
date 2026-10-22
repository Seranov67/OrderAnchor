import { writeFileSync } from 'node:fs';
import { decodeFunctionResult, formatEther, formatUnits, toFunctionSelector } from 'viem';
import { inspectMarket, publicReader, readOnlyMarkets, stringify } from '../src/read-only.ts';
import { accountPreflight } from '../src/preflight.ts';
import { operatorAbi, placementCall, type Intent } from '../src/protocol.ts';

// Public addresses only. No key loading, signing or broadcast in this script.
const owner = '0xCf0a0858C6F6e81e553E580af6617aa128E96533' as const;
const signer = '0xa50a0cC153807a86e55A613f327Be6752CdeB389' as const;
const path = 'evidence/first-operation-preflight-2026-10-22.json';
const sdk = readOnlyMarkets();
try {
  const market = await inspectMarket('ETH');
  const rpc = publicReader();
  const block = await rpc.getBlock();
  const pool = market.market.poolAddress;
  const marginBank = market.market.marginBank;
  const geometry = { tickSize:market.snapshot.parameters.tickSize.toString(), lotSize:market.snapshot.parameters.lotSize.toString(), minQuantity:market.snapshot.parameters.minQuantity.toString() };
  const tick = BigInt(geometry.tickSize), lot = BigInt(geometry.lotSize);
  const quantity = ((BigInt(geometry.minQuantity) + lot - 1n) / lot) * lot;
  // A small resting bid 5% below observed mark, never a market order.
  const price = (market.snapshot.mark.price * 95n / 100n / tick) * tick;
  if (!market.snapshot.mark.priceable || price <= 0n) throw new Error('Unusable mark');
  const selectors = { place: toFunctionSelector('placeOrderFor(address,bool,uint64,uint256,uint256,uint64,uint8,uint8,address,uint96)'), cancel: toFunctionSelector('cancelOrderFor(address,uint128)') };
  const [balance, ownerBalance, nonceLatest, noncePending, place, cancel, account] = await Promise.all([
    rpc.getBalance({address:signer,blockNumber:block.number}),
    rpc.getBalance({address:owner,blockNumber:block.number}),
    rpc.getTransactionCount({address:signer,blockTag:'latest'}),
    rpc.getTransactionCount({address:signer,blockTag:'pending'}),
    rpc.readContract({address:pool,abi:operatorAbi,functionName:'isOperatorAuthorized',args:[owner,signer,selectors.place],blockNumber:block.number}),
    rpc.readContract({address:pool,abi:operatorAbi,functionName:'isOperatorAuthorized',args:[owner,signer,selectors.cancel],blockNumber:block.number}),
    accountPreflight(sdk.client,{owner,signer,pool,marginBank,isBid:true,price,quantity,geometry}),
  ]);
  const intent: Intent = {id:'orderanchor-first-20261022',chainId:50383,owner,signer,pool,isBid:true,price:price.toString(),quantity:quantity.toString(),expireTimestampNs:((block.timestamp+900n)*1_000_000_000n).toString()};
  const call = placementCall(intent);
  const base = {at:new Date().toISOString(),chainId:50383,owner,signer,block:{number:block.number,hash:block.hash},signerSTT:formatEther(balance),ownerSTT:formatEther(ownerBalance),nonceLatest,noncePending,selectors,permissions:{place,cancel},market,account,intent,human:{market:'ETH-PERP',side:'BUY',type:'POST_ONLY',price:formatUnits(price,18),quantity:formatUnits(quantity,18),notionalUSDso:formatUnits(price*quantity/10n**18n,18)},signed:false,broadcast:false};
  writeFileSync(path,stringify({...base,status:'READS_COMPLETE'})+'\n');
  if (!place || !cancel || !account.sizeAccepted || balance===0n || nonceLatest!==noncePending) throw new Error('Preflight blocked: permissions, size, gas balance or pending nonce');
  const simulation = await rpc.call({account:signer,...call,blockNumber:block.number});
  if (!simulation.data) throw new Error('Simulation returned no data');
  const [simulationSuccess] = decodeFunctionResult({abi:operatorAbi,functionName:'placeOrderFor',data:simulation.data});
  if (!simulationSuccess) throw new Error('Simulation returned success=false');
  const [gasEstimate,fees] = await Promise.all([rpc.estimateGas({account:signer,...call}),rpc.estimateFeesPerGas()]);
  const gasLimit = gasEstimate*125n/100n;
  const gasCostCeiling = gasLimit*fees.maxFeePerGas;
  if(gasCostCeiling>balance || gasCostCeiling>100_000_000_000_000_000n) throw new Error('Gas ceiling exceeds balance or 0.1 STT budget');
  if((await rpc.getBlock({blockNumber:block.number})).hash!==block.hash) throw new Error('Snapshot block changed');
  const result = {...base,status:'SIMULATED_NOT_SIGNED',simulation,gasEstimate,gasLimit,fees,gasCostCeilingSTT:formatEther(gasCostCeiling),limitations:['SDK account/size reads and market discovery are not one atomic block snapshot','Cancel permission checked, cancellation simulation requires an actual orderId','Candidate expires 15 minutes after snapshot; rerun fresh checks before signing','No transaction signed or sent; POST_ONLY can still fill after resting']};
  writeFileSync(path,stringify(result)+'\n');
  console.log(stringify({status:result.status,signerSTT:result.signerSTT,ownerSTT:result.ownerSTT,permissions:result.permissions,margin:account.margin,position:account.position,maximum:account.maximum,human:result.human,simulation,gasEstimate,gasCostCeilingSTT:result.gasCostCeilingSTT,path}));
} catch(error) {
  console.error(error instanceof Error?error.message:'Preflight failed'); process.exitCode=1;
} finally {await sdk.close();}
