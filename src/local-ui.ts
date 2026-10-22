import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {parseBundle,makeBundle,verifyCycle,VerificationError,type CycleEvidence} from './evidence.ts';
import {verifierReads} from './verifier-rpc.ts';
import {stringify} from './read-only.ts';

export const UI_HOST='127.0.0.1:4317';
const configured=[{id:'orderanchor-first-20261022',label:'Normal cycle',db:'first-cycle.sqlite'},{id:'orderanchor-crash-20261022',label:'Crash recovery',db:'crash-cycle.sqlite'}];
interface Observation {at:string;status:string;result?:unknown;reason?:string}
export function createLocalUi(root=process.cwd(),recover?: (cycle:CycleEvidence)=>Promise<unknown>) {
  const token=randomBytes(32).toString('hex');let busy=false;
  const bundle=()=>parseBundle(JSON.parse(readFileSync(resolve(root,'evidence/testnet-cycles-export-v1.json'),'utf8')));
  const observationPath=(id:string)=>resolve(root,`data/ui/${id}.json`);
  function load() {
    const exported=bundle();
    const verification=JSON.parse(readFileSync(resolve(root,'evidence/testnet-cycles-verification-2026-10-22.json'),'utf8'));
    return configured.map(config=>{
      const cycle=exported.cycles.find(c=>c.intent.id===config.id);if(!cycle)throw new Error('Configured cycle missing');
      let journal:unknown=null,journalAvailable=false;
      const path=resolve(root,'secrets/orderanchor-bot-user',config.db);
      try {
        const db=new DatabaseSync(path,{readOnly:true});
        try {
          db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=0');
          const row=db.prepare('SELECT i.state,i.order_id,t.hash,t.nonce FROM intents i JOIN transactions t ON t.intent_id=i.id WHERE i.id=?').get(config.id);
          const cancellation=db.prepare('SELECT state,order_id,hash,nonce FROM cancellations WHERE parent_id=?').get(config.id);
          const events=db.prepare('SELECT type,at FROM events WHERE intent_id=? ORDER BY seq').all(config.id);
          journal={placement:row,cancellation,events};journalAvailable=!!row;
        } finally {db.close();}
      } catch {/* Cached public evidence remains clearly distinguished from an unavailable journal. */}
      let observation:Observation|null=null;
      if(existsSync(observationPath(config.id)))observation=JSON.parse(readFileSync(observationPath(config.id),'utf8')) as Observation;
      const initial=verification.results.find((r:{id:string})=>r.id===config.id);
      return {id:config.id,label:config.label,cycle,journal,journalAvailable,observation:observation??{at:verification.at,status:initial?.status??'UNVERIFIED',result:initial},cached:true};
    });
  }
  function reply(res:ServerResponse,status:number,value:unknown,type='application/json') {
    res.writeHead(status,{'Content-Type':`${type}; charset=utf-8`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",'Referrer-Policy':'no-referrer'});
    res.end(type==='application/json'?stringify(value):String(value));
  }
  const server=createServer(async(req:IncomingMessage,res:ServerResponse)=>{
    try {
      if(req.headers.host!==UI_HOST || req.headers['sec-fetch-site']==='cross-site')return reply(res,403,{error:'Local access only'});
      const url=new URL(req.url??'/',`http://${UI_HOST}`);
      if(req.method==='GET' && url.pathname==='/')return reply(res,200,readFileSync(resolve(root,'ui/index.html'),'utf8'),'text/html');
      if(req.method==='GET' && ['/app.js','/style.css'].includes(url.pathname))return reply(res,200,readFileSync(resolve(root,`ui${url.pathname}`),'utf8'),url.pathname.endsWith('.js')?'text/javascript':'text/css');
      if(req.method==='GET' && url.pathname==='/api/operations')return reply(res,200,{token,busy,operations:load(),mode:'RPC reads only; no signing or broadcast'});
      if(req.method==='GET' && url.pathname==='/api/export') {
        const selected=url.searchParams.get('id');
        if(selected && !configured.some(c=>c.id===selected))return reply(res,404,{error:'Unknown operation'});
        const cycles=bundle().cycles.filter(c=>!selected||c.intent.id===selected);
        res.setHeader('Content-Disposition',`attachment; filename="orderanchor-${selected??'cycles'}.json"`);
        return reply(res,200,makeBundle(cycles));
      }
      if(req.method==='POST' && url.pathname.startsWith('/api/recover/')) {
        const supplied=String(req.headers['x-orderanchor-token']??'');
        if(req.headers.origin!==`http://${UI_HOST}`||supplied.length!==token.length||!timingSafeEqual(Buffer.from(supplied),Buffer.from(token)))return reply(res,403,{error:'Invalid local request'});
        if(Number(req.headers['content-length']??0)>0||req.headers['transfer-encoding'])return reply(res,400,{error:'Request bodies are not supported'});
        const id=url.pathname.slice('/api/recover/'.length);
        if(!configured.some(c=>c.id===id))return reply(res,404,{error:'Unknown operation'});
        if(busy)return reply(res,409,{error:'A verification is already running'});
        busy=true;
        let observation:Observation;
        try {
          const cycle=bundle().cycles.find(c=>c.intent.id===id)!;
          const adapter=recover?null:verifierReads();
          try {observation={at:new Date().toISOString(),status:'VERIFIED',result:recover?await recover(cycle):await verifyCycle(cycle,adapter!.reads)};}
          finally {await adapter?.close();}
        } catch(error){observation={at:new Date().toISOString(),status:error instanceof VerificationError?'FAILED':'UNAVAILABLE',reason:error instanceof VerificationError?error.message:'RPC is unavailable or verification is incomplete; the previous result is not a fresh observation.'};}
        finally {busy=false;}
        mkdirSync(resolve(root,'data/ui'),{recursive:true});writeFileSync(observationPath(id),stringify(observation)+'\n');
        return reply(res,observation.status==='VERIFIED'?200:502,observation);
      }
      return reply(res,404,{error:'Not found'});
    } catch {return reply(res,500,{error:'Could not read local evidence. Check the project files.'});}
  });
  return server;
}
