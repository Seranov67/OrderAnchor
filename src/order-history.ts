import {toHex,toEventSelector,type Hex,type TransactionReceipt} from 'viem';
import {orderBookEventsAbi} from '@somnia-chain/markets-sdk';
import {setTimeout as pause} from 'node:timers/promises';

type Logs=TransactionReceipt['logs'];
export interface HistoryQuery {address:Hex;fromBlock:bigint;toBlock:bigint;topics:(Hex|null)[]}
export type HistoryRead=(query:HistoryQuery)=>Promise<Logs>;
const filledTopic=toEventSelector(orderBookEventsAbi.find(e=>e.name==='OrderFilled')!);
const key=(l:Logs[number])=>`${l.blockHash}:${l.logIndex}`;
const identity=(l:Logs[number])=>JSON.stringify([l.address.toLowerCase(),l.blockHash,l.blockNumber.toString(),l.logIndex,l.transactionHash,l.transactionIndex,l.removed,l.data,l.topics]);

/** Complete block coverage, restricted to this order, including BOTH fill roles. */
export async function readOrderHistory(read:HistoryRead,pool:Hex,from:bigint,to:bigint,orderId:bigint):Promise<Logs> {
  if(from<0n||to<from||to-from>1_000_000n)throw new Error('History range outside verifier bounds');
  if(orderId<=0n||orderId>=1n<<128n)throw new Error('Invalid history order ID');
  const topic=toHex(orderId,{size:32}),all:Logs=[];
  async function query(request:HistoryQuery):Promise<Logs> {
    // A bounded retry of a READ only. Never omit a failed range or use cached success.
    let logs:Logs;
    try {logs=await read(request);} catch {await pause(150);logs=await read(request);}
    const seen=new Set<string>();
    for(const log of logs) {
      if(log.blockNumber===null||log.blockHash===null||log.logIndex===null||log.transactionHash===null||log.transactionIndex===null||log.removed||log.address.toLowerCase()!==pool.toLowerCase()||log.blockNumber<request.fromBlock||log.blockNumber>request.toBlock)throw new Error('Invalid filtered history log');
      if(!request.topics.every((value,index)=>value===null||log.topics[index]===value))throw new Error('History RPC ignored topic filter');
      if(seen.has(key(log)))throw new Error('Duplicate history log in RPC response');
      seen.add(key(log));
    }
    return logs;
  }
  async function range(start:bigint):Promise<Logs> {
    const end=start+999n<to?start+999n:to;
    // Every SDK order event has orderId in topic[1], except maker fills in topic[2].
    const [primary,maker]=await Promise.all([
      query({address:pool,fromBlock:start,toBlock:end,topics:[null,topic]}),
      query({address:pool,fromBlock:start,toBlock:end,topics:[filledTopic,null,topic]}),
    ]);
    const merged=[...primary],seen=new Map(primary.map(l=>[key(l),l]));
    for(const log of maker) {
      const prior=seen.get(key(log));
      if(prior) {
        // One fill can match both roles; merge only byte-identical overlap.
        if(prior.topics[0]!==filledTopic||prior.topics[1]!==topic||prior.topics[2]!==topic||identity(prior)!==identity(log))throw new Error('Conflicting overlapping history log');
      } else {merged.push(log);seen.set(key(log),log);}
    }
    return merged.sort((a,b)=>a.blockNumber===b.blockNumber?a.logIndex-b.logIndex:a.blockNumber<b.blockNumber?-1:1);
  }
  // Two ranges in flight, at most four RPC reads. Preserve chronological batches.
  for(let start=from;start<=to;start+=2000n) {
    const ranges=[range(start)];if(start+1000n<=to)ranges.push(range(start+1000n));
    for(const logs of await Promise.all(ranges))all.push(...logs);
  }
  return all;
}
