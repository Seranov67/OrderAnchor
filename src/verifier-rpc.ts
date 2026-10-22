import type {VerifierReads} from './evidence.ts';
import {publicReader,readOnlyMarkets} from './read-only.ts';
import {formatLog} from 'viem';
import {readOrderHistory} from './order-history.ts';

/** This adapter exposes no signing/broadcast method. */
export function verifierReads() {
  const rpc=publicReader(),abort=new AbortController(),sdk=readOnlyMarkets(abort.signal);
  const timer=setTimeout(()=>abort.abort(),120_000);
  const reads:VerifierReads={
    chainId:()=>rpc.getChainId(),head:()=>rpc.getBlockNumber(),transaction:hash=>rpc.getTransaction({hash}),receipt:hash=>rpc.getTransactionReceipt({hash}),
    async block(number){const b=await rpc.getBlock({blockNumber:number});return {hash:b.hash,number:b.number};},
    nonce:(address,block)=>rpc.getTransactionCount({address,blockNumber:block}),
    order:(pool,id,block)=>sdk.client.getOrderOnchain(pool,id,{blockNumber:block}),
    logs:(pool,from,to,orderId)=>readOrderHistory(async query=>{
      const raw=await rpc.request({method:'eth_getLogs',params:[{address:query.address,fromBlock:`0x${query.fromBlock.toString(16)}`,toBlock:`0x${query.toBlock.toString(16)}`,topics:query.topics}]});
      return raw.map(log=>formatLog(log)) as Awaited<ReturnType<VerifierReads['logs']>>;
    },pool,from,to,orderId),
  };
  return {reads,async close(){clearTimeout(timer);abort.abort();await sdk.close();}};
}
