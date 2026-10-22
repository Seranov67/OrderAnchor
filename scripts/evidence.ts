import {readFileSync,writeFileSync} from 'node:fs';
import {exportCycle,makeBundle,parseBundle,verifyCycle,VerificationError} from '../src/evidence.ts';
import {stringify} from '../src/read-only.ts';
import {verifierReads} from '../src/verifier-rpc.ts';

const [mode,input,output,...rest]=process.argv.slice(2);
try {
  if(mode==='export') {
    if(!input||!output||rest.length!==1)throw new Error('Usage: export <normal-report> <output-bundle> <crash-report>');
    const cycles=[input,rest[0]!].map(path=>exportCycle(JSON.parse(readFileSync(path,'utf8'))));
    const bundle=makeBundle(cycles);parseBundle(bundle);
    writeFileSync(output,stringify(bundle)+'\n',{flag:'wx'});
    console.log(stringify({exported:output,cycles:cycles.length,sha256:bundle.sha256,networkWrites:0}));
  } else if(mode==='verify') {
    if(!input||!output)throw new Error('Usage: verify <bundle> <new-output-report>');
    const bundle=parseBundle(JSON.parse(readFileSync(input,'utf8')));
    const adapter=verifierReads(),reads=adapter.reads;
    const results=[];
    try {
      for(const cycle of bundle.cycles) {
        try {const result=await verifyCycle(cycle,reads);results.push(result);console.log(stringify({id:result.id,status:result.status,state:result.state}));}
        catch(error){const result={id:cycle.intent.id,status:error instanceof VerificationError?'FAILED':'UNAVAILABLE',reason:error instanceof VerificationError?error.message:'RPC/read/decode unavailable; verification incomplete'};results.push(result);console.log(stringify(result));}
      }
    } finally {await adapter.close();}
    const verified=results.every(r=>r.status==='VERIFIED');
    const result={schema:'orderanchor-verification/v1',at:new Date().toISOString(),bundleSha256:bundle.sha256,verified,results,networkWrites:0,limitations:['Fresh RPC is the trust source; not a cryptographic light-client consensus proof','SHA-256 detects changes, not author authenticity','Process kill/restart and send-attempt counts are local claims; chain proves mined transactions in the stated nonce/block interval']};
    writeFileSync(output,stringify(result)+'\n',{flag:'wx'});if(!verified)process.exitCode=1;
  } else throw new Error('Commands: export | verify');
} catch(error){console.error(error instanceof Error?error.message:'Evidence operation failed');process.exitCode=1;}
