import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { decodeFunctionData, keccak256, recoverTransactionAddress, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { cancellationCall, normalizeIntent, operatorAbi, placementCall } from '../src/protocol.ts';
import { signPlacement, verifySignedCall } from '../src/signing.ts';
import { OperationStore } from '../src/store.ts';
import { broadcastOnce } from '../src/executor.ts';
import { resume } from '../src/reconciler.ts';
import { fixture, evidence } from './fixtures/data.ts';

const sandbox = resolve('tmp');
mkdirSync(sandbox,{recursive:true});
function dbPath() { return resolve(mkdtempSync(`${sandbox}/core-test-`), 'operations.sqlite'); }

test('POST_ONLY operator payload and cancel encode exact official selectors', async () => {
  const f = await fixture();
  const call = placementCall(f.intent);
  const decoded = decodeFunctionData({ abi: operatorAbi, data: call.data });
  assert.equal(call.data.slice(0,10), '0x80054449');
  assert.equal(decoded.functionName, 'placeOrderFor');
  if (decoded.functionName !== 'placeOrderFor') throw new Error('Unexpected method');
  assert.equal(decoded.args[3], BigInt(f.intent.price));
  assert.equal(decoded.args[4], BigInt(f.intent.quantity));
  assert.equal(decoded.args[6], 3);
  assert.equal(cancellationCall(f.intent.owner, f.intent.pool, '123').data.slice(0,10),'0xe37b444b');
});

test('hash and recovered signer are known locally; nonce changes hash', async () => {
  const f = await fixture();
  assert.equal(f.signed.hash, keccak256(f.signed.serialized));
  assert.equal(await recoverTransactionAddress({ serializedTransaction: f.signed.serialized }), f.account.address);
  assert.equal(await verifySignedCall(placementCall(f.intent), f.intent.signer, f.signed), 7);
  const second = await signPlacement(f.intent, f.account, { ...f.fees, nonce: 8 });
  assert.notEqual(second.hash, f.signed.hash);
});

test('invalid input, wrong signer and altered payload are rejected', async () => {
  const f = await fixture();
  assert.throws(() => normalizeIntent({ ...f.intent, chainId: 5031 as 50383 }),/testnet/);
  assert.throws(() => normalizeIntent({ ...f.intent, quantity: '-1' }),/unsigned/);
  assert.throws(() => normalizeIntent({ ...f.intent, price: '0' }),/positive/);
  await assert.rejects(signPlacement(f.intent, privateKeyToAccount(generatePrivateKey()), f.fees), /Signer/);
  await assert.rejects(verifySignedCall(placementCall({ ...f.intent, quantity: '1' }),f.intent.signer,f.signed),/match/);
});

test('signed transaction persists; same ID is idempotent and other unresolved intent blocked', async () => {
  const file = dbPath(), f = await fixture();
  let store = new OperationStore(file,{create:true});
  try {
    await store.prepare(f.intent,f.signed);
    await store.prepare(f.intent,f.signed);
    assert.equal(store.events(f.intent.id).length,1);
    const second = { ...f.intent,id:'another-id' };
    await assert.rejects(store.prepare(second,f.signed),/UNIQUE/);
    const changed = await signPlacement(f.intent,f.account,{...f.fees,nonce:8});
    await assert.rejects(store.prepare(f.intent,changed),/conflict/);
    assert(!JSON.stringify(store.list()).includes(f.signed.serialized));
  } finally { store.close(); }
  store = new OperationStore(file);
  try { assert.equal(store.get(f.intent.id)?.hash,f.signed.hash); assert.equal(store.signedForBroadcast(f.intent.id).serialized,f.signed.serialized); }
  finally { store.close(); }
});

test('only one executor owns the database at a time', async () => {
  const file=dbPath(),store=new OperationStore(file,{create:true});
  try { assert.throws(()=>new OperationStore(file),/locked|busy/i); }
  finally {store.close();}
  const next=new OperationStore(file);next.close();
});

test('missing/corrupt databases refuse to initialize silently', () => {
  const file=dbPath();assert.throws(()=>new OperationStore(file),/missing/);assert(!existsSync(file));
  writeFileSync(file,'invalid database');assert.throws(()=>new OperationStore(file),/database|file|schema/i);
  assert.equal(readFileSync(file,'utf8'),'invalid database');
});

test('transport sees committed hash and UNKNOWN before send; lost response cannot be resent', async () => {
  const store=new OperationStore(dbPath(),{create:true}),f=await fixture();let sends=0;
  try {
    await store.prepare(f.intent,f.signed);
    const result=await broadcastOnce(store,f.intent.id,{async sendRawTransaction(bytes){
      sends++;assert.equal(store.get(f.intent.id)?.state,'UNKNOWN');assert.equal(keccak256(bytes),store.get(f.intent.id)?.hash);
      throw new Error('fixture: accepted but response lost');
    }});
    assert.equal(result.state,'UNKNOWN');assert.equal(result.hash,f.signed.hash);
    await assert.rejects(broadcastOnce(store,f.intent.id,{async sendRawTransaction(){sends++;return f.signed.hash;}}),/never-attempted/);
    assert.equal(sends,1);
  } finally {store.close();}
});

test('closed store cannot reach the transport', async () => {
  const store=new OperationStore(dbPath(),{create:true}),f=await fixture();await store.prepare(f.intent,f.signed);store.close();let sends=0;
  await assert.rejects(broadcastOnce(store,f.intent.id,{async sendRawTransaction(){sends++;return f.signed.hash;}}));assert.equal(sends,0);
});

test('failed atomic state/event write rolls back and cannot reach transport', async () => {
  const store=new OperationStore(dbPath(),{create:true}),f=await fixture();let sends=0;
  try {
    await store.prepare(f.intent,f.signed);
    const db=(store as unknown as {db:DatabaseSync}).db;
    db.exec("CREATE TRIGGER fail_broadcast BEFORE INSERT ON events WHEN NEW.type='UNKNOWN' BEGIN SELECT RAISE(ABORT,'fixture storage failure'); END;");
    await assert.rejects(broadcastOnce(store,f.intent.id,{async sendRawTransaction(){sends++;return f.signed.hash;}}),/fixture storage failure/);
    assert.equal(sends,0);assert.equal(store.get(f.intent.id)?.state,'SIGNED');assert.equal(store.events(f.intent.id).length,1);
  }finally{store.close();}
});

test('RPC returning a different hash gives CONFLICT', async () => {
  const store=new OperationStore(dbPath(),{create:true}),f=await fixture();
  try {await store.prepare(f.intent,f.signed);assert.equal((await broadcastOnce(store,f.intent.id,{async sendRawTransaction(){return `0x${'f'.repeat(64)}`;}})).state,'CONFLICT');}
  finally {store.close();}
});

test('read-only resume validates canonical receipt and exact OrderPlaced', async () => {
  const store=new OperationStore(dbPath(),{create:true}),f=await fixture();
  try {
    await store.prepare(f.intent,f.signed);let reads=0;
    const result=await resume(store,f.intent.id,{async read(){reads++;return evidence(f);}});
    assert.equal(reads,1);assert.equal(result.state,'CONFIRMED');assert.equal(result.orderId,'123');
    assert(!JSON.stringify(store.events(f.intent.id)).includes(f.signed.serialized));
  } finally {store.close();}
});

test('null receipt and missing confirmations remain unknown', async () => {
  const store=new OperationStore(dbPath(),{create:true}),f=await fixture();
  try {
    await store.prepare(f.intent,f.signed);await broadcastOnce(store,f.intent.id,{async sendRawTransaction(){return f.signed.hash;}});
    assert.equal((await resume(store,f.intent.id,{async read(){return {...evidence(f),receipt:null};}})).state,'UNKNOWN');
    assert.equal((await resume(store,f.intent.id,{async read(){return {...evidence(f),head:100n};}})).state,'UNKNOWN');
  }finally{store.close();}
});

test('receipt success without exact order identity is not lifecycle proof', async () => {
  const store=new OperationStore(dbPath(),{create:true}),f=await fixture();
  try {
    await store.prepare(f.intent,f.signed);const observed=evidence(f);observed.receipt!.logs=[];
    const result=await resume(store,f.intent.id,{async read(){return observed;}});
    assert.equal(result.state,'UNKNOWN');assert.equal(result.orderId,null);
  }finally{store.close();}
});

test('unavailable RPC does not present cached confirmation as a fresh read', async () => {
  const store=new OperationStore(dbPath(),{create:true}),f=await fixture();
  try {
    await store.prepare(f.intent,f.signed);await resume(store,f.intent.id,{async read(){return evidence(f);}});
    await assert.rejects(resume(store,f.intent.id,{async read(){throw new Error('fixture RPC down');}}),/not been refreshed/);
  }finally{store.close();}
});

test('malformed known fill event is unknown even when OrderPlaced is valid', async () => {
  const store=new OperationStore(dbPath(),{create:true}),f=await fixture();
  try {
    await store.prepare(f.intent,f.signed);const observed=evidence(f);
    const {toEventSelector}=await import('viem');
    observed.receipt!.logs.push({...observed.receipt!.logs[0]!,topics:[toEventSelector('OrderFilled(uint128,uint128,uint256,uint256,uint256,uint256)')],data:'0x'});
    assert.equal((await resume(store,f.intent.id,{async read(){return observed;}})).state,'UNKNOWN');
  }finally{store.close();}
});

test('wrong target is conflict; changed block hash returns to unknown', async () => {
  const f=await fixture(),file=dbPath();let store=new OperationStore(file,{create:true});
  try {
    await store.prepare(f.intent,f.signed);await resume(store,f.intent.id,{async read(){return evidence(f);}});
    assert.equal((await resume(store,f.intent.id,{async read(){return {...evidence(f),canonicalBlockHash:`0x${'e'.repeat(64)}` as Hex};}})).state,'UNKNOWN');
    const wrong=evidence(f);wrong.transaction!.to=f.intent.owner;
    assert.equal((await resume(store,f.intent.id,{async read(){return wrong;}})).state,'CONFLICT');
  }finally{store.close();}
});

test('actual child exits after fixture acceptance; new process state resumes without a send', async () => {
  const file=dbPath(),f=await fixture(),marker=resolve(file,'../accepted.json');
  let store=new OperationStore(file,{create:true});await store.prepare(f.intent,f.signed);store.close();
  const worker=fileURLToPath(new URL('./fixtures/crash-worker.ts',import.meta.url));
  const child=spawnSync(process.execPath,['--import','tsx',worker,file,f.intent.id,marker],{timeout:15000,encoding:'utf8',windowsHide:true});
  assert.equal(child.status,73,child.stderr);assert.equal(JSON.parse(readFileSync(marker,'utf8')).sends,1);
  store=new OperationStore(file);
  try {
    assert.equal(store.get(f.intent.id)?.state,'UNKNOWN');
    assert.equal(store.get(f.intent.id)?.hash,f.signed.hash);
    const result=await resume(store,f.intent.id,{async read(){return evidence(f);}});
    assert.equal(result.orderId,'123');assert.equal(result.state,'CONFIRMED');
    await assert.rejects(broadcastOnce(store,f.intent.id,{async sendRawTransaction(){throw Error('Must not send after resume');}}),/never-attempted/);
    assert.equal(JSON.parse(readFileSync(marker,'utf8')).sends,1);
  }finally{store.close();}
});

test('actual child exits before send; resume observes but does not broadcast signed bytes', async () => {
  const file=dbPath(),f=await fixture(),marker=resolve(file,'../not-accepted.json');
  let store=new OperationStore(file,{create:true});await store.prepare(f.intent,f.signed);store.close();
  const worker=fileURLToPath(new URL('./fixtures/crash-worker.ts',import.meta.url));
  const child=spawnSync(process.execPath,['--import','tsx',worker,file,f.intent.id,marker,'before-send'],{timeout:15000,encoding:'utf8',windowsHide:true});
  assert.equal(child.status,74,child.stderr);assert(!existsSync(marker));
  store=new OperationStore(file);
  try {
    assert.equal((await resume(store,f.intent.id,{async read(){return {transaction:null,receipt:null,head:1n,canonicalBlockHash:null};}})).state,'SIGNED');
    assert(!existsSync(marker));
  }finally{store.close();}
});
