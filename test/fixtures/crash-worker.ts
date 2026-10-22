import { writeFileSync } from 'node:fs';
import { OperationStore } from '../../src/store.ts';
import { broadcastOnce } from '../../src/executor.ts';
import { keccak256 } from 'viem';

const [file, id, marker, mode] = process.argv.slice(2);
if (!file || !id || !marker) throw new Error('Fixture arguments required');
const store = new OperationStore(file);
if (mode === 'before-send') process.exit(74);
await broadcastOnce(store, id, { async sendRawTransaction(serialized) {
  // A local fixture records acceptance; no RPC. Exit bypasses store.close/finally.
  writeFileSync(marker, JSON.stringify({ acceptedHash: keccak256(serialized), sends: 1 }));
  process.exit(73);
} });
