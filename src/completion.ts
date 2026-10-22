import {parseAbi,type Hex} from 'viem';
import {verifyCycle,type CycleEvidence,type VerifierReads} from './evidence.ts';
import {publicReader} from './read-only.ts';
import {verifierReads} from './verifier-rpc.ts';

export interface CompletionProof {
  id:string;chainId:50383;owner:Hex;signer:Hex;pool:Hex;placeHash:Hex;cancelHash:Hex;orderId:string;
  state:'CANCELLED';filled:'0';remaining:'0';position:'0';lockedCollateral:'0';activePools:0;
  nextNonce:number;pendingNonce:number;blockNumber:string;blockHash:Hex;checkedAt:number;
}
export interface CompletionReads extends VerifierReads {
  account(pool:Hex,owner:Hex,block:bigint):Promise<{position:bigint;lockedCollateral:bigint;activePools:number;healthy:boolean}>;
  pendingNonce(signer:Hex):Promise<number>;
}
export async function proveCompletion(cycle:CycleEvidence,rpc:CompletionReads):Promise<CompletionProof> {
  const verified=await verifyCycle(cycle,rpc);
  const block=await rpc.block(BigInt(verified.snapshot.blockNumber));
  const [account,latest,pending]=await Promise.all([rpc.account(cycle.intent.pool,cycle.intent.owner,block.number),rpc.nonce(cycle.intent.signer,block.number),rpc.pendingNonce(cycle.intent.signer)]);
  if(account.position!==0n||account.lockedCollateral!==0n||account.activePools!==0||!account.healthy)throw new Error('Account exposure remains; completion cannot unlock signer');
  if(latest!==cycle.cancel.nonce+1||pending!==latest)throw new Error('External or pending signer activity; completion cannot unlock signer');
  if((await rpc.block(block.number)).hash!==block.hash)throw new Error('Completion snapshot changed');
  return {id:cycle.intent.id,chainId:50383,owner:cycle.intent.owner,signer:cycle.intent.signer,pool:cycle.intent.pool,placeHash:cycle.place.hash,cancelHash:cycle.cancel.hash,orderId:cycle.orderId,state:'CANCELLED',filled:'0',remaining:'0',position:'0',lockedCollateral:'0',activePools:0,nextNonce:latest,pendingNonce:pending,blockNumber:block.number.toString(),blockHash:block.hash,checkedAt:Date.now()};
}
const abi=parseAbi([
  'function marginBank() view returns (address)',
  'function getPosition(address account,address perpPool) view returns ((int128 size,uint128 avgEntryPrice,int256 entryFundingIndex,uint64 lastUpdatedTimestampNs))',
  'function getAccountState(address account) view returns ((int256 unlockedCollateralBalance,uint256 lockedCollateral,address[] activePerpPools))',
  'function getMarginStatus(address account) view returns (uint8)',
]);
export function completionReads() {
  const base=verifierReads(),rpc=publicReader();
  const reads:CompletionReads={...base.reads,pendingNonce:signer=>rpc.getTransactionCount({address:signer,blockTag:'pending'}),
    async account(pool,owner,blockNumber){
      const bank=await rpc.readContract({address:pool,abi,functionName:'marginBank',blockNumber});
      const [position,state,status]=await Promise.all([
        rpc.readContract({address:bank,abi,functionName:'getPosition',args:[owner,pool],blockNumber}),
        rpc.readContract({address:bank,abi,functionName:'getAccountState',args:[owner],blockNumber}),
        rpc.readContract({address:bank,abi,functionName:'getMarginStatus',args:[owner],blockNumber}),
      ]);
      return {position:position.size,lockedCollateral:state.lockedCollateral,activePools:state.activePerpPools.length,healthy:status===0};
    }};
  return {reads,close:base.close};
}
