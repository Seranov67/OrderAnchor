import {createLocalUi} from '../src/local-ui.ts';
const server=createLocalUi();
server.listen(4317,'127.0.0.1',()=>console.log('OrderAnchor: http://127.0.0.1:4317 — read-only RPC, no signing/broadcast'));
server.on('error',()=>{console.error('Could not start OrderAnchor: port 4317 is busy or unavailable.');process.exitCode=1;});
