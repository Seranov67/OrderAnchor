import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exactUnits, validateGeometry } from '../src/preflight.ts';

test('raw quantities preserve differing base decimals, including NEAR 24',()=>{
  assert.equal(exactUnits('0.1',9),100000000n);
  assert.equal(exactUnits('0.1',18),100000000000000000n);
  assert.equal(exactUnits('0.1',24),100000000000000000000000n);
  assert.throws(()=>exactUnits('0.0000000001',9),/precision/);
  for(const bad of ['1e3','-1','NaN','0x10'])assert.throws(()=>exactUnits(bad,18),/decimal/);
});
test('off-grid and under-minimum orders fail before any account/RPC checks',()=>{
  const g={tickSize:'10',lotSize:'5',minQuantity:'20'};
  validateGeometry(100n,20n,g);
  assert.throws(()=>validateGeometry(101n,20n,g),/tick/);
  assert.throws(()=>validateGeometry(100n,21n,g),/lot/);
  assert.throws(()=>validateGeometry(100n,15n,g),/minimum/);
});
