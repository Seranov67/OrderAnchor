import {readFileSync,writeFileSync} from 'node:fs';
import {parseBundle} from '../src/evidence.ts';
import {proveCompletion,completionReads} from '../src/completion.ts';
import {stringify} from '../src/read-only.ts';
// Dry-run: no key, SQLite open, migration, release commit or send.
const bundle=parseBundle(JSON.parse(readFileSync('evidence/testnet-cycles-export-v1.json','utf8')));
const adapter=completionReads(),results=[];
try {
  for(const cycle of bundle.cycles) {
    try {results.push({id:cycle.intent.id,eligible:true,committed:false,proof:await proveCompletion(cycle,adapter.reads)});}
    catch {results.push({id:cycle.intent.id,eligible:false,committed:false,reason:'No fresh completion proof: account exposure, signer nonce, RPC or canonicality must be checked; lock remains active.'});}
  }
} finally {await adapter.close();}
const report={at:new Date().toISOString(),networkWrites:0,localReleaseCommits:0,results};
writeFileSync('evidence/completion-check-2026-10-22.json',stringify(report)+'\n');console.log(stringify(report));
