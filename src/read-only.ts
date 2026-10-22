import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES } from '@somnia-chain/markets-sdk';
import { createPublicClient, http, parseAbi, TransactionNotFoundError, TransactionReceiptNotFoundError, type Hex } from 'viem';
import { chain, INDEXER_URL, RPC_URL, WS_URL, assertTestnet } from './config.ts';
import type { ReadTransport } from './reconciler.ts';
import type { OrderReadTransport } from './lifecycle.ts';

export function publicReader() {
  return createPublicClient({ chain, transport: http(RPC_URL, { timeout: 15_000, retryCount: 0 }) });
}

/** Canonical bounded reads; no indexer history is used as evidence of cancellation. */
export function orderReadTransport():OrderReadTransport {
  const rpc=publicReader();
  return {async snapshot(pool,orderId,fromBlock) {
    assertTestnet(await rpc.getChainId());
    const head=await rpc.getBlockNumber();
    if(head<2n) throw new Error('Insufficient chain history');
    const block=await rpc.getBlock({blockNumber:head-1n});
    if(block.number<fromBlock) throw new Error('Placement does not yet have two confirmations');
    // Refuse an unbounded history query; chunked backfill belongs to a later version.
    if(block.number-fromBlock>20_000n) throw new Error('Order history exceeds first-cycle read window');
    const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),30_000);
    const sdk=readOnlyMarkets(abort.signal);
    try {
      const [order,logs]=await Promise.all([
        sdk.client.getOrderOnchain(pool,orderId,{blockNumber:block.number}),
        rpc.getLogs({address:pool,fromBlock,toBlock:block.number}),
      ]);
      const canonical=await rpc.getBlock({blockNumber:block.number});
      return {blockNumber:block.number,blockHash:block.hash,canonicalBlockHash:canonical.hash,order,logs};
    } finally {clearTimeout(timer);abort.abort();await sdk.close();}
  }};
}
export function readOnlyMarkets(signal?: AbortSignal) {
  return new SomniaMarkets({ chain, indexerUrl: INDEXER_URL, wsRpcUrl: WS_URL, addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES, signal });
}
const bookAbi = parseAbi([
  'function getOrderBookParameters() view returns (uint256 tickSize, uint256 minQuantity, uint256 lotSize)',
  'function tryGetMarkPrice() view returns (bool ok, uint256 price)',
  'function marginBank() view returns (address)',
]);

export async function inspectMarket(base = 'ETH') {
  if (!/^[A-Z0-9]{1,12}$/.test(base)) throw new Error('Invalid base symbol');
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 45_000);
  const sdk = readOnlyMarkets(abort.signal);
  const rpc = publicReader();
  try {
    assertTestnet(await rpc.getChainId());
    const markets = await sdk.client.listPerpMarkets({ limit: 100 });
    const market = markets.find(m => m.baseSymbol === base);
    if (!market) throw new Error('Requested market not found');
    const system = await sdk.client.getPerpSystemConfig(market.marginBank);
    const registered = await sdk.client.isPerpPoolRegistered({ pool: market.poolAddress, marginBank: market.marginBank });
    if (!registered || market.quoteToken.toLowerCase() !== system.collateralToken.toLowerCase()) throw new Error('Market registration/collateral binding failed');
    const block = await rpc.getBlock();
    const [parameters, mark, bank, code] = await Promise.all([
      rpc.readContract({ address: market.poolAddress, abi: bookAbi, functionName: 'getOrderBookParameters', blockNumber: block.number }),
      rpc.readContract({ address: market.poolAddress, abi: bookAbi, functionName: 'tryGetMarkPrice', blockNumber: block.number }),
      rpc.readContract({ address: market.poolAddress, abi: bookAbi, functionName: 'marginBank', blockNumber: block.number }),
      rpc.getBytecode({ address: market.poolAddress, blockNumber: block.number }),
    ]);
    if (!code || code === '0x' || bank.toLowerCase() !== market.marginBank.toLowerCase()) throw new Error('Pool bytecode/bank binding failed');
    const canonical = await rpc.getBlock({ blockNumber: block.number });
    if (canonical.hash !== block.hash) throw new Error('Snapshot block changed');
    return { at: new Date().toISOString(), chainId: chain.id, sdkVersion: '0.32.1', marketsCount: markets.length,
      market, system, registered, snapshot: { blockNumber: block.number, blockHash: block.hash, parameters: { tickSize: parameters[0], minQuantity: parameters[1], lotSize: parameters[2] }, mark: { priceable: mark[0], price: mark[1] }, bank, codeBytes: (code.length - 2) / 2 },
      limits: ['SDK discovery/system/registration reads are not pinned to the HTTP snapshot block', 'No owner, signer, margin, permissions, gas estimate, simulation or live transaction tested'] };
  } finally { clearTimeout(timer); abort.abort(); await sdk.close(); }
}

export function readTransport(): ReadTransport {
  const rpc = publicReader();
  return { async read(hash: Hex) {
    assertTestnet(await rpc.getChainId());
    const [tx, receipt, head] = await Promise.all([
      rpc.getTransaction({ hash }).catch(e => { if (e instanceof TransactionNotFoundError) return null; throw e; }),
      rpc.getTransactionReceipt({ hash }).catch(e => { if (e instanceof TransactionReceiptNotFoundError) return null; throw e; }),
      rpc.getBlockNumber(),
    ]);
    const block = receipt ? await rpc.getBlock({ blockNumber: receipt.blockNumber }) : null;
    return { transaction: tx ? { hash: tx.hash, from: tx.from, to: tx.to, input: tx.input, nonce: tx.nonce, chainId: tx.chainId ?? chain.id, value: tx.value } : null, receipt, head, canonicalBlockHash: block?.hash ?? null };
  } };
}

export const stringify = (value: unknown) => JSON.stringify(value, (_key, v: unknown) => typeof v === 'bigint' ? v.toString() : v, 2);
