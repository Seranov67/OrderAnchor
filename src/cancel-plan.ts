import { formatEther } from 'viem';
import { assertTestnet } from './config.ts';
import { cancellationCall,operatorAbi } from './protocol.ts';
import { inspectOrder,type OrderReadTransport } from './lifecycle.ts';
import { resume,type ReadTransport } from './reconciler.ts';
import { OperationStore } from './store.ts';
import type { publicReader } from './read-only.ts';

/** Read-only preparation. Never loads a key, signs, or submits a transaction. */
export async function planCancellation(store:OperationStore,id:string,receipts:ReadTransport,orders:OrderReadTransport,rpc:ReturnType<typeof publicReader>) {
  assertTestnet(await rpc.getChainId());
  const parent=await resume(store,id,receipts);
  if(parent.state!=='CONFIRMED'||!parent.orderId) throw new Error('Placement must be freshly confirmed');
  if(store.getCancel(id)) throw new Error('Existing cancellation must be reconciled; a new plan is blocked');
  const lifecycle=await inspectOrder(store,id,orders);
  if(!lifecycle.canCancel) throw new Error(`No verified remaining order to cancel: ${lifecycle.state}`);
  const {owner,signer,pool}=parent.intent;
  const call=cancellationCall(owner,pool,parent.orderId);
  const [allowed,balance,latest,pending]=await Promise.all([
    rpc.readContract({address:pool,abi:operatorAbi,functionName:'isOperatorAuthorized',args:[owner,signer,'0xe37b444b']}),
    rpc.getBalance({address:signer}),rpc.getTransactionCount({address:signer,blockTag:'latest'}),rpc.getTransactionCount({address:signer,blockTag:'pending'}),
  ]);
  if(!allowed || latest!==pending || latest!==parent.nonce+1) throw new Error('Cancel permission or dedicated signer nonce check failed');
  await rpc.call({account:signer,...call});
  const [gas,fees]=await Promise.all([rpc.estimateGas({account:signer,...call}),rpc.estimateFeesPerGas()]);
  const gasLimit=(gas*125n+99n)/100n,cost=gasLimit*fees.maxFeePerGas;
  if(cost>balance || cost>100_000_000_000_000_000n) throw new Error('Cancel exceeds balance or 0.1 STT ceiling');
  return {parentId:id,orderId:parent.orderId,chainId:50383,signer,call,nonce:latest,gas:gasLimit,...fees,costCeilingSTT:formatEther(cost),lifecycle,signed:false,broadcast:false,warning:'Revalidate before signing. Remaining can fill between read and cancellation; receipt and lifecycle read-back are mandatory.'};
}
