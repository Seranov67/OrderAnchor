import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Public, read-only probes. No wallet, signing, transactions or subscriptions.
const rpcUrl = 'https://api.hideki2.infra.testnet.somnia.network';
const wsUrl = 'wss://api.hideki2.infra.testnet.somnia.network/ws';
const indexerUrl = 'https://hideki-dev.smk.somnia.host/v1/graphql';
const startedAt = new Date().toISOString();
let nextId = 1;
const records = [];
const quantity = x => typeof x === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(x);
const hexData = x => typeof x === 'string' && /^0x(?:[0-9a-f]{2})*$/i.test(x);
function envelope(body, id) {
  if (!body || Array.isArray(body) || body.jsonrpc !== '2.0' || body.id !== id ||
      (Object.hasOwn(body, 'result') === Object.hasOwn(body, 'error'))) throw Error('Invalid RPC envelope');
  if (Object.hasOwn(body, 'error')) throw Error(`RPC error: ${JSON.stringify(body.error)}`);
  return body.result;
}
async function post(url, request) {
  const record = { at: new Date().toISOString(), url, request };
  records.push(record);
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request), signal: AbortSignal.timeout(15000) });
    record.status = response.status;
    record.body = await response.text();
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    return JSON.parse(record.body);
  } catch (error) {
    record.error = error.message;
    if (error.cause) record.cause = String(error.cause);
    throw error;
  }
}
async function rpc(method, params, validate) {
  const id = nextId++;
  const result = envelope(await post(rpcUrl, { jsonrpc: '2.0', id, method, params }), id);
  if (!validate(result)) throw Error(`Invalid ${method} result`);
  return result;
}
const outcome = {};
async function check(name, run) {
  try { outcome[name] = { ok: true, ...(await run()) }; }
  catch (error) { outcome[name] = { ok: false, error: error.message, cause: error.cause ? String(error.cause) : undefined }; }
}
await Promise.all([
  check('httpChain', async () => {
    const chainId = await rpc('eth_chainId', [], quantity);
    if (BigInt(chainId) !== 50383n) throw Error(`Wrong chain ${chainId}`);
    return { chainId, chainIdDecimal: Number(BigInt(chainId)) };
  }),
  check('latestBlock', async () => {
    const block = await rpc('eth_getBlockByNumber', ['latest', false], b => b && quantity(b.number) && quantity(b.timestamp) && /^0x[0-9a-f]{64}$/i.test(b.hash));
    return { blockNumber: BigInt(block.number).toString(), blockHash: block.hash,
      blockTime: new Date(Number(BigInt(block.timestamp)) * 1000).toISOString(), ageSeconds: Math.round(Date.now()/1000 - Number(BigInt(block.timestamp))) };
  }),
  check('gasPrice', async () => ({ wei: BigInt(await rpc('eth_gasPrice', [], quantity)).toString() })),
  check('indexer', async () => {
    const body = await post(indexerUrl, { query: '{ __typename }' });
    if (!body || Array.isArray(body) || body.errors || typeof body.data?.__typename !== 'string') throw Error('Invalid GraphQL result');
    return { typename: body.data.__typename, scope: 'Root query only; market and account queries not verified' };
  }),
  check('websocket', () => new Promise((resolve, reject) => {
    const id = nextId++;
    const request = { jsonrpc: '2.0', id, method: 'eth_chainId', params: [] };
    const record = { at: new Date().toISOString(), url: wsUrl, request };
    records.push(record);
    const ws = new WebSocket(wsUrl);
    let done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true; clearTimeout(timer); ws.close();
      if (error) { record.error = error.message; reject(error); } else resolve(value);
    };
    const timer = setTimeout(() => finish(Error('WebSocket timeout')), 15000);
    ws.addEventListener('open', () => ws.send(JSON.stringify(request)));
    ws.addEventListener('message', event => {
      record.body = String(event.data);
      try {
        const chainId = envelope(JSON.parse(record.body), id);
        if (!quantity(chainId) || BigInt(chainId) !== 50383n) throw Error('Wrong WebSocket chain');
        finish(null, { chainId, scope: 'RPC request over WebSocket; subscription recovery not tested' });
      } catch (error) { finish(error); }
    });
    ws.addEventListener('error', () => finish(Error('WebSocket connection error')));
    ws.addEventListener('close', () => { if (!done) finish(Error('WebSocket closed before response')); });
  })),
]);
if (outcome.httpChain.ok && outcome.latestBlock.ok) {
  const blockTag = '0x' + BigInt(outcome.latestBlock.blockNumber).toString(16);
  const contracts = {
    MarginBank: '0x478769E1177C0773c43A593DCCc4Ad15F15F1394',
    USDso: '0xed7993A74dAe1e6656B704A424DcD8711aAf4F72',
    OperatorPermissionsRegistry: '0x6B2FbfeD328FF5F20C0BE7D3C3437613aFFE8D3a',
    VoucherDistributor: '0x2ACD9EFdA721450906bfE1bef3edE269636E42C4',
  };
  await Promise.all(Object.entries(contracts).map(([name, address]) => check(name, async () => {
    const code = await rpc('eth_getCode', [address, blockTag], hexData);
    if (code === '0x') throw Error('No contract bytecode');
    return { address, blockTag, byteLength: (code.length-2)/2, sha256: createHash('sha256').update(Buffer.from(code.slice(2), 'hex')).digest('hex'),
      scope: 'Bytecode present; contract behavior and configuration not verified' };
  })));
}
const report = { startedAt, completedAt: new Date().toISOString(), node: process.version, outcome, records };
await mkdir(new URL('../evidence/', import.meta.url), { recursive: true });
const reportUrl = new URL(`../evidence/network-${startedAt.replaceAll(':', '-')}.json`, import.meta.url);
await writeFile(reportUrl, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ report: reportUrl.pathname, outcome }, null, 2));
process.exitCode = Object.values(outcome).every(x => x.ok) ? 0 : 1;
