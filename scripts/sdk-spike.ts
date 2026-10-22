import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { decodeFunctionData, keccak256, recoverTransactionAddress, toFunctionSelector } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { ORDER_TYPE, perpPoolWriteAbi, TransactionOutcomeUnknownError } from '@somnia-chain/markets-sdk';
import { CHAIN_ID } from '../src/config.ts';
import { operatorAbi, placementCall, cancellationCall, type Intent } from '../src/protocol.ts';
import { signPlacement, verifySignedCall } from '../src/signing.ts';

// Unfunded ephemeral fixture only. No key or signed transaction is written to evidence.
const account = privateKeyToAccount(generatePrivateKey());
const intent: Intent = { id: 'offline-spike', chainId: CHAIN_ID, owner: '0x00000000000000000000000000000000000000aa', signer: account.address,
  pool: '0x00000000000000000000000000000000000000bb', isBid: true, price: '2000000000000000000000', quantity: '10000000000000000', expireTimestampNs: '1000000000' };
const call = placementCall(intent);
const signed = await signPlacement(intent, account, { nonce: 0, gas: 10_000_000n, maxFeePerGas: 6_000_000_000n, maxPriorityFeePerGas: 0n });
await verifySignedCall(call, account.address, signed);
const decoded = decodeFunctionData({ abi: operatorAbi, data: call.data });
const cancel = cancellationCall(intent.owner, intent.pool, '123');
const unknown = new TransactionOutcomeUnknownError({ chainId: CHAIN_ID, operation: 'fixture', hash: signed.hash });
const pkg = (p: string) => JSON.parse(readFileSync(`node_modules/${p}/package.json`, 'utf8')) as { version: string; peerDependencies?: unknown; peerDependenciesMeta?: unknown };
const sdk = pkg('@somnia-chain/markets-sdk');
const report = { at: new Date().toISOString(), runtime: process.version, versions: { sdk: sdk.version, viem: pkg('viem').version, typescript: pkg('typescript').version },
  sdkPeerDependencies: sdk.peerDependencies, sdkOptionalPeers: sdk.peerDependenciesMeta,
  lockSha256: createHash('sha256').update(readFileSync('package-lock.json')).digest('hex'),
  checks: { rootImport: true, postOnly: ORDER_TYPE.POST_ONLY, placeSelector: call.data.slice(0,10), cancelSelector: cancel.data.slice(0,10),
    expectedPlaceSelector: toFunctionSelector('placeOrderFor(address,bool,uint64,uint256,uint256,uint64,uint8,uint8,address,uint96)'),
    decodedFunction: decoded.functionName, hashKnownBeforeNetwork: signed.hash === keccak256(signed.serialized), signerRecovered: (await recoverTransactionAddress({ serializedTransaction: signed.serialized })) === account.address,
    sdkUnknownErrorRetainsHash: unknown.hash === signed.hash,
    sdkPerpWriteFunctions: perpPoolWriteAbi.filter(x => x.type === 'function').map(x => x.name) },
  transactionHash: signed.hash, scope: 'Offline expired synthetic call; ephemeral unfunded key in memory, no wallet, network transport or broadcast',
  limits: ['Not a live simulation, permission/funding check or testnet execution', 'Typed imports and runtime signing do not prove every SDK endpoint'] };
assert.equal(report.versions.sdk,'0.32.1'); assert.equal(report.versions.viem,'2.54.1');
assert.equal(report.checks.postOnly,3);assert.equal(report.checks.placeSelector,report.checks.expectedPlaceSelector);
assert(report.checks.hashKnownBeforeNetwork && report.checks.signerRecovered && report.checks.sdkUnknownErrorRetainsHash);
const sourceFiles = ['src/config.ts','src/executor/local.ts','src/txSend.ts','src/errors.ts','src/tradeAbi.ts','src/decode/orders.ts','dist/index.d.ts'];
const provenance = {at:report.at,sdkVersion:sdk.version,lockSha256:report.lockSha256,packageIntegrity:JSON.parse(readFileSync('package-lock.json','utf8')).packages['node_modules/@somnia-chain/markets-sdk'].integrity as string,
  files:sourceFiles.map(path=>({path,sha256:createHash('sha256').update(readFileSync(`node_modules/@somnia-chain/markets-sdk/${path}`)).digest('hex')})),
  findings:['SDK local executor has an in-memory nonce lane and typed unknown outcome with hash','SDK sending verbs await receipt; no durable pre-broadcast callback on built-in local executor','Operator ABI is not in SDK perpPoolWriteAbi; sourced from pinned official MIT bot kit','Headless root import works without optional React/Reactivity peers']};
mkdirSync('evidence', { recursive: true });
writeFileSync('evidence/sdk-offline-2026-10-20.json', JSON.stringify(report,null,2)+'\n');
writeFileSync('evidence/sdk-source-2026-10-20.json',JSON.stringify(provenance,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
