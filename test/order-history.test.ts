import {test} from 'node:test';
import assert from 'node:assert/strict';
import {toHex,toEventSelector,type Hex,type TransactionReceipt} from 'viem';
import {orderBookEventsAbi} from '@somnia-chain/markets-sdk';
import {readOrderHistory,type HistoryQuery,type HistoryRead} from '../src/order-history.ts';

const pool='0x00000000000000000000000000000000000000bb' as Hex;
const hash=`0x${'1'.repeat(64)}` as Hex,topic=toHex(123n,{size:32}),other=toHex(456n,{size:32});
const event=(name:string)=>toEventSelector(orderBookEventsAbi.find(e=>e.name===name)!);
function log(name:string,topics:Hex[],index=0,block=10n):TransactionReceipt['logs'][number] {
  return {address:pool,blockHash:hash,blockNumber:block,transactionHash:hash,transactionIndex:0,logIndex:index,removed:false,data:'0x',topics:[event(name),...topics]};
}
const matches=(l:TransactionReceipt['logs'][number],q:HistoryQuery)=>l.blockNumber>=q.fromBlock&&l.blockNumber<=q.toBlock&&q.topics.every((t,i)=>t===null||l.topics[i]===t);

test('history covers every block through snapshot, bounds concurrency, and filters both indexed roles',async()=>{
  const queries:HistoryQuery[]=[];let active=0,max=0;
  await readOrderHistory(async q=>{queries.push(q);active++;max=Math.max(max,active);await Promise.resolve();active--;return [];},pool,10n,2010n,123n);
  assert.equal(queries.length,6);assert.equal(max,4);
  for(const [from,to] of [[10n,1009n],[1010n,2009n],[2010n,2010n]]) {
    const chunk=queries.filter(q=>q.fromBlock===from&&q.toBlock===to);
    assert.equal(chunk.length,2);assert.deepEqual(chunk.map(q=>q.topics),[[null,topic],[event('OrderFilled'),null,topic]]);
  }
});

test('all current SDK non-fill events index orderId first; fills index taker and maker',()=>{
  for(const e of orderBookEventsAbi) {
    const indexed=e.inputs.filter(i=>i.indexed).map(i=>i.name);
    assert.deepEqual(indexed,e.name==='OrderFilled'?['takerOrderId','makerOrderId']:['orderId']);
  }
});

test('keeps placements, reductions, cancellations, maker fills and taker fills, in order',async()=>{
  const entries=[log('OrderPlaced',[topic],0),log('OrderFilled',[other,topic],1),log('OrderFilled',[topic,other],2),log('OrderReduced',[topic],3),log('OrderCancelled',[topic],4)];
  const result=await readOrderHistory(async q=>entries.filter(l=>matches(l,q)).reverse(),pool,10n,10n,123n);
  assert.deepEqual(result,entries);
});

test('merges identical dual-role overlap but rejects conflicting payloads',async()=>{
  const entry=log('OrderFilled',[topic,topic]);
  assert.equal((await readOrderHistory(async()=>[entry],pool,10n,10n,123n)).length,1);
  await assert.rejects(readOrderHistory(async q=>[{...entry,data:q.topics[0]===null?'0x':'0x01'}],pool,10n,10n,123n),/Conflicting/);
});

test('one transient read failure is retried without dropping the range',async()=>{
  let first=0;
  const read:HistoryRead=async q=>{if(q.topics[0]===null&&++first===1)throw new Error('body limit');return q.topics[0]===null?[log('OrderPlaced',[topic])]:[];};
  const result=await readOrderHistory(read,pool,10n,10n,123n);assert.equal(first,2);assert.equal(result.length,1);
});

test('persistent read failure fails closed after a bounded retry',async()=>{
  let failedCalls=0;
  await assert.rejects(readOrderHistory(async q=>{if(q.topics[0]===null){failedCalls++;throw new Error('RPC offline');}return [];},pool,10n,10n,123n),/RPC offline/);
  assert.equal(failedCalls,2);
});

test('rejects ignored topic filters, foreign pools, out-of-range, removed and pending logs',async()=>{
  const original=log('OrderPlaced',[topic]);
  for(const entry of [log('OrderPlaced',[other]),{...original,address:'0x00000000000000000000000000000000000000cc' as Hex},{...original,blockNumber:11n},{...original,removed:true},{...original,blockHash:null}]) {
    await assert.rejects(readOrderHistory(async q=>q.topics[0]===null?[entry as typeof original]:[],pool,10n,10n,123n),/history log|topic filter/);
  }
});

test('duplicate provider entries are rejected, not silently deduplicated',async()=>{
  const entry=log('OrderPlaced',[topic]);
  await assert.rejects(readOrderHistory(async q=>q.topics[0]===null?[entry,entry]:[],pool,10n,10n,123n),/Duplicate/);
});

test('invalid order and block bounds issue no RPC requests',async()=>{
  let calls=0;const read:HistoryRead=async()=>{calls++;return [];};
  for(const [from,to,id] of [[-1n,10n,123n],[11n,10n,123n],[0n,1_000_001n,123n],[0n,1n,0n],[0n,1n,1n<<128n]])await assert.rejects(readOrderHistory(read,pool,from!,to!,id!));
  assert.equal(calls,0);
});
