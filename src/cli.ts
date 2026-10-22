import { inspectMarket, readTransport, orderReadTransport, publicReader, stringify } from './read-only.ts';
import { planCancellation } from './cancel-plan.ts';
import { resumeCancel, inspectOrder } from './lifecycle.ts';
import { OperationStore } from './store.ts';
import { resume } from './reconciler.ts';
import {readFileSync} from 'node:fs';
import {parseBundle} from './evidence.ts';
import {proveCompletion,completionReads} from './completion.ts';

const [command, ...args] = process.argv.slice(2);
try {
  if (command === 'inspect-market') console.log(stringify(await inspectMarket(args[0] ?? 'ETH')));
  else if (['status','resume','resume-cancel','inspect-order','plan-cancel','check-release','release-next'].includes(command!)) {
    const [file, id] = args;
    if (!file) throw new Error('Usage: status <existing-db> | resume <existing-db> <operation-id>');
    const store = new OperationStore(file);
    try {
      if(command==='check-release'||command==='release-next') {
        if(!id||!args[2])throw new Error('Usage: check-release|release-next <existing-db> <operation-id> <bundle>');
        const cycle=parseBundle(JSON.parse(readFileSync(args[2],'utf8'))).cycles.find(c=>c.intent.id===id);
        if(!cycle)throw new Error('Cycle missing from bundle');
        const adapter=completionReads();
        try {
          const check=()=>proveCompletion(cycle,adapter.reads);
          console.log(stringify(command==='release-next'?await store.release(id,check):{eligible:true,proof:await store.checkRelease(id,check),committed:false}));
        } finally {await adapter.close();}
      } else if(command==='plan-cancel') {
        if(!id) throw new Error('Operation ID required');
        console.log(stringify(await planCancellation(store,id,readTransport(),orderReadTransport(),publicReader())));
      } else if (command === 'resume-cancel' || command === 'inspect-order') {
        if(!id) throw new Error('Operation ID required');
        const parent=await resume(store,id,readTransport());
        if(parent.state!=='CONFIRMED') throw new Error('Placement is not currently confirmed');
        console.log(stringify(command==='resume-cancel'?await resumeCancel(store,id,readTransport()):await inspectOrder(store,id,orderReadTransport())));
      } else if (command === 'resume') {
        if (!id) throw new Error('Operation ID required');
        console.log(stringify(await resume(store, id, readTransport())));
      } else console.log(stringify(id ? {placement:store.get(id)??null,cancellation:store.getCancel(id)??null} : store.list().map(placement=>({placement,cancellation:store.getCancel(placement.id)??null}))));
    } finally { store.close(); }
  } else if (command === 'help' || !command) console.log('OrderAnchor prototype: inspect-market [ETH] | status <existing-db> [id] | resume <existing-db> <id> | inspect-order <existing-db> <id> | resume-cancel <existing-db> <id> | plan-cancel <existing-db> <id> | check-release <db> <id> <bundle> | release-next <db> <id> <bundle>\nNetwork operations are read-only. release-next changes only the local durable gate. Live placement, cancellation and signing CLI are not enabled.');
  else throw new Error('Unknown command; run cli -- help');
} catch (error) { console.error(error instanceof Error ? error.message : 'Operation failed'); process.exitCode = 1; }
