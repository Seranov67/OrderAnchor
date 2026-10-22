import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createLocalUi,UI_HOST} from '../src/local-ui.ts';
import {parseBundle} from '../src/evidence.ts';
import {request as httpRequest} from 'node:http';
test('local UI: allowlisted views, export, request protection and read-only recovery',async t=>{
  mkdirSync('tmp',{recursive:true});const root=resolve(mkdtempSync('tmp/ui-test-'));mkdirSync(resolve(root,'evidence'));mkdirSync(resolve(root,'ui'));
  for(const file of ['testnet-cycles-export-v1.json','testnet-cycles-verification-2026-10-22.json'])copyFileSync(resolve('evidence',file),resolve(root,'evidence',file));
  writeFileSync(resolve(root,'ui/index.html'),'<h1>OrderAnchor</h1>');
  let calls=0,release:()=>void=()=>{};
  const server=createLocalUi(root,async cycle=>{calls++;await new Promise<void>(r=>{release=r;});return {id:cycle.intent.id,status:'VERIFIED',state:'CANCELLED',filled:'0',remaining:'0'};});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const address=server.address();if(!address||typeof address==='string')throw new Error('Missing port');
  const url=`http://127.0.0.1:${address.port}`;
  const request=(path:string,init:RequestInit={})=>new Promise<Response>((resolve,reject)=>{
    const req=httpRequest(url+path,{method:init.method??'GET',headers:{Host:UI_HOST,...init.headers as Record<string,string>}},res=>{const chunks:Buffer[]=[];res.on('data',chunk=>chunks.push(Buffer.from(chunk)));res.on('end',()=>resolve(new Response(Buffer.concat(chunks).toString(),{status:res.statusCode??500,headers:res.headers as Record<string,string>})));});req.on('error',reject);req.end();
  });
  try {
    const state=await(await request('/api/operations')).json();const id=state.operations[0].id;
    await t.test('lists only public fields and marks unavailable journal',async()=>{assert.equal(state.operations.length,2);assert.equal(state.operations[0].journalAvailable,false);assert(!JSON.stringify(state).includes('serialized'));assert.equal((await request('/secrets/orderanchor-bot-user/private-key.dpapi')).status,404);});
    await t.test('exports a valid portable single-cycle bundle',async()=>{const response=await request(`/api/export?id=${id}`);assert.match(response.headers.get('content-disposition')??'',/attachment/);assert.equal(parseBundle(await response.json()).cycles.length,1);assert.equal((await request('/api/export?id=unknown')).status,404);});
    await t.test('rejects hostile hosts, origins and missing tokens',async()=>{
      assert.equal((await request('/api/operations',{headers:{Host:'evil.example'}})).status,403);
      assert.equal((await request(`/api/recover/${id}`,{method:'POST'})).status,403);
      assert.equal((await request(`/api/recover/${id}`,{method:'POST',headers:{Origin:'http://evil.example','X-OrderAnchor-Token':state.token}})).status,403);assert.equal(calls,0);
    });
    await t.test('serializes recovery and persists only derived observations',async()=>{
      const headers={Origin:`http://${UI_HOST}`,'X-OrderAnchor-Token':state.token};
      const first=request(`/api/recover/${id}`,{method:'POST',headers});
      for(let i=0;i<50&&calls===0;i++)await new Promise(r=>setTimeout(r,5));
      assert.equal(calls,1);assert.equal((await request(`/api/recover/${id}`,{method:'POST',headers})).status,409);
      release();assert.equal((await first).status,200);
      const updated=await(await request('/api/operations')).json();assert.equal(updated.operations[0].observation.status,'VERIFIED');assert.equal(updated.operations[0].observation.result.state,'CANCELLED');
      assert.equal((await request('/api/recover/unknown',{method:'POST',headers})).status,404);
    });
  } finally {release();await new Promise<void>(r=>server.close(()=>r()));}
});
