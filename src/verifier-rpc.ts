import type {VerifierReads} from './evidence.ts';
import {publicReader,readOnlyMarkets} from './read-only.ts';

/** This adapter exposes no signing/broadcast method. */
export function verifierReads() {
  const rpc=publicReader(),abort=new AbortController(),sdk=readOnlyMarkets(abort.signal);
  const timer=setTimeout(()=>abort.abort(),120_000);
  const reads:VerifierReads={
    chainId:()=>rpc.getChainId(),head:()=>rpc.getBlockNumber(),transaction:hash=>rpc.getTransaction({hash}),receipt:hash=>rpc.getTransactionReceipt({hash}),
    async block(number){const b=await rpc.getBlock({blockNumber:number});return {hash:b.hash,number:b.number};},
    nonce:(address,block)=>rpc.getTransactionCount({address,blockNumber:block}),
    order:(pool,id,block)=>sdk.client.getOrderOnchain(pool,id,{blockNumber:block}),
    async logs(pool,from,to){
      if(to<from||to-from>1_000_000n)throw new Error('History range outside verifier bounds');
      const all=[];
      for(let start=from;start<=to;start+=1000n)all.push(...await rpc.getLogs({address:pool,fromBlock:start,toBlock:start+999n<to?start+999n:to}));
      return all;
    },
  };
  return {reads,async close(){clearTimeout(timer);abort.abort();await sdk.close();}};
}
