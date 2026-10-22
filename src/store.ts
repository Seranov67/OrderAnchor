import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Hex, TransactionSerialized } from 'viem';
import { normalizeIntent, placementCall, cancellationCall, type Intent } from './protocol.ts';
import { verifySignedCall, type Signed } from './signing.ts';
import type { CompletionProof } from './completion.ts';

export type TxState = 'SIGNED' | 'UNKNOWN' | 'SUBMITTED' | 'CONFIRMED' | 'REVERTED' | 'CONFLICT';
export interface RecordView { id: string; intent: Intent; state: TxState; hash: Hex; nonce: number; orderId: string | null; released:boolean }
export interface CancelView { parentId: string; orderId: string; state: TxState; hash: Hex; nonce: number }
interface Row { id: string; intent_json: string; state: TxState; hash: Hex; nonce: number; signed: TransactionSerialized; order_id: string | null }

/** Single-writer prototype. Exclusive lifetime SQLite lock prevents a second executor process. */
export class OperationStore {
  private readonly db: DatabaseSync;
  private closed = false;
  constructor(file: string, options: { create?: boolean } = {}) {
    const existed = existsSync(file);
    if (!existed && !options.create) throw new Error('Operation database missing; explicit initialization required');
    if (!existed) mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file, { enableForeignKeyConstraints: true });
    try {
      this.db.exec('PRAGMA busy_timeout=0; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA locking_mode=EXCLUSIVE;');
      const version = (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
      if (existed && ![2,3,4].includes(version)) throw new Error('Unsupported or uninitialized database schema');
      if (!existed) this.db.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE intents (id TEXT PRIMARY KEY, chain_id INTEGER NOT NULL, signer TEXT NOT NULL, intent_json TEXT NOT NULL,
          state TEXT NOT NULL CHECK(state IN ('SIGNED','UNKNOWN','SUBMITTED','CONFIRMED','REVERTED','CONFLICT')),
          order_id TEXT);
        CREATE UNIQUE INDEX one_unresolved_signer ON intents(chain_id,signer) WHERE state != 'REVERTED';
        CREATE TABLE transactions (intent_id TEXT PRIMARY KEY REFERENCES intents(id), kind TEXT NOT NULL CHECK(kind='place'),
          hash TEXT NOT NULL UNIQUE, nonce INTEGER NOT NULL, signed TEXT NOT NULL,
          state TEXT NOT NULL CHECK(state IN ('SIGNED','UNKNOWN','SUBMITTED','CONFIRMED','REVERTED','CONFLICT')));
        CREATE TABLE events (seq INTEGER PRIMARY KEY, intent_id TEXT NOT NULL REFERENCES intents(id), type TEXT NOT NULL, body TEXT NOT NULL, at TEXT NOT NULL);
        CREATE TABLE observations (seq INTEGER PRIMARY KEY, intent_id TEXT NOT NULL REFERENCES intents(id), body TEXT NOT NULL, at TEXT NOT NULL);
        PRAGMA user_version=2;
        COMMIT;
      `);
      if (version < 3) this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE cancellations (parent_id TEXT PRIMARY KEY REFERENCES intents(id), order_id TEXT NOT NULL,
          hash TEXT NOT NULL UNIQUE, nonce INTEGER NOT NULL, signed TEXT NOT NULL,
          state TEXT NOT NULL CHECK(state IN ('SIGNED','UNKNOWN','SUBMITTED','CONFIRMED','REVERTED','CONFLICT')));
        PRAGMA user_version=3; COMMIT;`);
      if(version<4)this.db.exec(`BEGIN IMMEDIATE;
        ALTER TABLE intents ADD COLUMN released INTEGER NOT NULL DEFAULT 0 CHECK(released IN (0,1));
        DROP INDEX one_unresolved_signer;
        CREATE UNIQUE INDEX one_unresolved_signer ON intents(chain_id,signer) WHERE released=0;
        CREATE TABLE completion_releases(parent_id TEXT PRIMARY KEY REFERENCES intents(id),proof TEXT NOT NULL);
        CREATE TABLE halted_signers(chain_id INTEGER NOT NULL,signer TEXT NOT NULL,PRIMARY KEY(chain_id,signer));
        PRAGMA user_version=4; COMMIT;`);
      // Acquire and retain EXCLUSIVE mode's file lock, without a network-spanning transaction.
      this.db.exec('BEGIN IMMEDIATE; COMMIT;');
      const check = this.db.prepare('PRAGMA quick_check').get() as { quick_check: string };
      if (check.quick_check !== 'ok') throw new Error('Database integrity check failed');
    } catch (e) { this.db.close(); throw e; }
  }
  private atomic<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  private event(id: string, type: string, body: unknown): void {
    this.db.prepare('INSERT INTO events(intent_id,type,body,at) VALUES(?,?,?,?)').run(id, type, JSON.stringify(body), new Date().toISOString());
  }
  async prepare(input: Intent, signed: Signed,checkPrevious?:()=>Promise<CompletionProof>): Promise<RecordView> {
    const intent = normalizeIntent(input);
    const nonce = await verifySignedCall(placementCall(intent), intent.signer, signed);
    const previous=this.db.prepare('SELECT id FROM intents WHERE chain_id=? AND signer=? AND released=1 ORDER BY rowid DESC LIMIT 1').get(intent.chainId,intent.signer.toLowerCase()) as {id:string}|undefined;
    let revision:number|undefined;
    if(previous && !this.get(intent.id)) {
      if(!checkPrevious)throw new Error('Fresh previous completion check required before next operation');
      revision=this.revision(previous.id);
      const proof=await checkPrevious();this.validateCompletion(previous.id,proof);
      const old=this.get(previous.id)!;
      if(proof.nextNonce!==nonce||intent.owner!==old.intent.owner||intent.pool!==old.intent.pool)throw new Error('Next operation must use verified nonce and same owner/pool lane');
    }
    return this.atomic(() => {
      this.assertNotHalted(intent.chainId,intent.signer);
      if(previous && revision!==undefined && this.revision(previous.id)!==revision)throw new Error('Completion changed during next-operation preparation');
      const existing = this.get(intent.id);
      if (existing) {
        if (JSON.stringify(existing.intent) !== JSON.stringify(intent) || existing.hash !== signed.hash) throw new Error('Operation ID conflict: immutable intent or signed transaction changed');
        return existing;
      }
      this.db.prepare('INSERT INTO intents(id,chain_id,signer,intent_json,state) VALUES(?,?,?,?,?)')
        .run(intent.id, intent.chainId, intent.signer.toLowerCase(), JSON.stringify(intent), 'SIGNED');
      this.db.prepare("INSERT INTO transactions(intent_id,kind,hash,nonce,signed,state) VALUES(?,'place',?,?,?,'SIGNED')")
        .run(intent.id, signed.hash, nonce, signed.serialized);
      this.event(intent.id, 'SIGNED_COMMITTED', { hash: signed.hash, nonce });
      return this.get(intent.id)!;
    });
  }
  get(id: string): RecordView | undefined {
    const row = this.db.prepare('SELECT i.id,i.intent_json,i.state,t.hash,t.nonce,i.order_id,i.released FROM intents i JOIN transactions t ON t.intent_id=i.id WHERE i.id=?').get(id) as (Omit<Row,'signed'>&{released:number}) | undefined;
    return row && { id: row.id, intent: JSON.parse(row.intent_json) as Intent, state: row.state, hash: row.hash, nonce: row.nonce, orderId: row.order_id,released:row.released===1 };
  }
  list(): RecordView[] {
    return (this.db.prepare('SELECT id FROM intents ORDER BY id').all() as { id: string }[]).map(r => this.get(r.id)!);
  }
  /** Internal executor boundary; status/export never return broadcastable bytes. */
  signedForBroadcast(id: string): Signed {
    const parent=this.get(id);
    if(!parent||parent.released)throw new Error('Released operation cannot broadcast');
    this.assertNotHalted(parent.intent.chainId,parent.intent.signer);
    const row = this.db.prepare('SELECT signed,hash,state FROM transactions WHERE intent_id=?').get(id) as Pick<Row,'signed'|'hash'|'state'> | undefined;
    if (!row || row.state !== 'SIGNED') throw new Error('Only a never-attempted signed operation may broadcast');
    return { serialized: row.signed, hash: row.hash };
  }
  async assertBroadcastReady(id:string,checkPrevious?:()=>Promise<CompletionProof>):Promise<void> {
    const root=this.get(id);if(!root)throw new Error('Unknown operation');
    this.assertNotHalted(root.intent.chainId,root.intent.signer);
    const previous=this.db.prepare('SELECT id FROM intents WHERE chain_id=? AND signer=? AND released=1 AND id!=? ORDER BY rowid DESC LIMIT 1').get(root.intent.chainId,root.intent.signer.toLowerCase(),id) as {id:string}|undefined;
    if(previous) {
      if(!checkPrevious)throw new Error('Fresh previous completion check required before broadcast');
      const revision=this.revision(previous.id),proof=await checkPrevious();
      this.validateCompletion(previous.id,proof);
      if(this.revision(previous.id)!==revision||this.get(id)?.state!=='SIGNED'||proof.nextNonce!==root.nonce)throw new Error('Broadcast completion/nonce changed');
    }
  }
  transition(id: string, expected: TxState[], state: TxState, body: unknown, orderId?: string): void {
    this.atomic(() => {
      const row = this.get(id);
      if (!row || !expected.includes(row.state)) throw new Error('Invalid operation state transition');
      if(row.released && state!=='CONFIRMED')this.db.prepare('INSERT OR IGNORE INTO halted_signers(chain_id,signer) VALUES(?,?)').run(row.intent.chainId,row.intent.signer.toLowerCase());
      this.db.prepare('UPDATE intents SET state=?,order_id=COALESCE(?,order_id) WHERE id=?').run(state, orderId ?? null, id);
      this.db.prepare('UPDATE transactions SET state=? WHERE intent_id=?').run(state,id);
      this.event(id, state, body);
    });
  }
  observe(id: string, body: unknown): void {
    this.db.prepare('INSERT INTO observations(intent_id,body,at) VALUES(?,?,?)').run(id, JSON.stringify(body), new Date().toISOString());
  }
  events(id: string): { type: string; body: unknown; at: string }[] {
    return (this.db.prepare('SELECT type,body,at FROM events WHERE intent_id=? ORDER BY seq').all(id) as {type:string;body:string;at:string}[])
      .map(x => ({ ...x, body: JSON.parse(x.body) as unknown }));
  }
  getCancel(parentId: string): CancelView | undefined {
    const row = this.db.prepare('SELECT parent_id,order_id,state,hash,nonce FROM cancellations WHERE parent_id=?').get(parentId) as {parent_id:string;order_id:string;state:TxState;hash:Hex;nonce:number}|undefined;
    return row && {parentId:row.parent_id,orderId:row.order_id,state:row.state,hash:row.hash,nonce:row.nonce};
  }
  async prepareCancel(parentId: string, signed: Signed): Promise<CancelView> {
    const parent = this.get(parentId);
    if (!parent || parent.state !== 'CONFIRMED' || !parent.orderId) throw new Error('Confirmed placement and exact orderId required');
    const nonce = await verifySignedCall(cancellationCall(parent.intent.owner,parent.intent.pool,parent.orderId),parent.intent.signer,signed);
    if(nonce <= parent.nonce) throw new Error('Cancel nonce must follow placement');
    return this.atomic(()=>{
      const current=this.get(parentId);
      if(!current || current.state!=='CONFIRMED' || current.orderId!==parent.orderId || current.hash!==parent.hash) throw new Error('Placement changed during cancel preparation');
      const existing=this.getCancel(parentId);
      if(existing) {
        if(existing.hash!==signed.hash) throw new Error('Cancellation conflict: replacement requires manual reconciliation');
        return existing;
      }
      this.db.prepare("INSERT INTO cancellations(parent_id,order_id,hash,nonce,signed,state) VALUES(?,?,?,?,?,'SIGNED')").run(parentId,parent.orderId!,signed.hash,nonce,signed.serialized);
      this.event(parentId,'CANCEL_SIGNED_COMMITTED',{hash:signed.hash,nonce,orderId:parent.orderId});
      return this.getCancel(parentId)!;
    });
  }
  signedCancelForBroadcast(parentId:string): Signed {
    const parent=this.get(parentId);
    const row=this.db.prepare('SELECT signed,hash,state FROM cancellations WHERE parent_id=?').get(parentId) as Pick<Row,'signed'|'hash'|'state'>|undefined;
    if(!parent || parent.state!=='CONFIRMED' || !row || row.state!=='SIGNED' || this.getCancel(parentId)?.orderId!==parent.orderId) throw new Error('Only a never-attempted cancel of a confirmed placement may broadcast');
    return {serialized:row.signed,hash:row.hash};
  }
  transitionCancel(parentId:string,expected:TxState[],state:TxState,body:unknown):void {
    this.atomic(()=>{
      const row=this.getCancel(parentId);
      if(!row || !expected.includes(row.state)) throw new Error('Invalid cancellation state transition');
      const parent=this.get(parentId)!;
      if(parent.released && state!=='CONFIRMED')this.db.prepare('INSERT OR IGNORE INTO halted_signers(chain_id,signer) VALUES(?,?)').run(parent.intent.chainId,parent.intent.signer.toLowerCase());
      this.db.prepare('UPDATE cancellations SET state=? WHERE parent_id=?').run(state,parentId);
      this.event(parentId,`CANCEL_${state}`,body);
    });
  }
  private revision(id:string):number {return (this.db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM events WHERE intent_id=?').get(id) as {seq:number}).seq;}
  private assertNotHalted(chain:number,signer:string):void {
    if(this.db.prepare('SELECT 1 FROM halted_signers WHERE chain_id=? AND signer=?').get(chain,signer.toLowerCase()))throw new Error('Signer halted after released-history conflict; manual reconciliation required');
  }
  private validateCompletion(id:string,p:CompletionProof):void {
    const root=this.get(id),cancel=this.getCancel(id);
    if(!root||!cancel||root.state!=='CONFIRMED'||cancel.state!=='CONFIRMED'||!root.orderId)throw new Error('Confirmed place and cancel required for release');
    if(p.id!==id||p.chainId!==root.intent.chainId||p.owner.toLowerCase()!==root.intent.owner.toLowerCase()||p.signer.toLowerCase()!==root.intent.signer.toLowerCase()||p.pool.toLowerCase()!==root.intent.pool.toLowerCase()||p.placeHash!==root.hash||p.cancelHash!==cancel.hash||p.orderId!==root.orderId||p.state!=='CANCELLED'||p.filled!=='0'||p.remaining!=='0'||p.position!=='0'||p.lockedCollateral!=='0'||p.activePools!==0||p.nextNonce!==cancel.nonce+1||p.pendingNonce!==p.nextNonce||!Number.isSafeInteger(p.nextNonce)||!/^0x[0-9a-f]{64}$/i.test(p.blockHash)||!/^\d+$/.test(p.blockNumber)||!Number.isSafeInteger(p.checkedAt)||Date.now()-p.checkedAt>30_000||p.checkedAt>Date.now()+1000)throw new Error('Completion proof is mismatched, stale or unsafe');
    this.assertNotHalted(root.intent.chainId,root.intent.signer);
  }
  async checkRelease(id:string,check:()=>Promise<CompletionProof>):Promise<CompletionProof> {
    const revision=this.revision(id),proof=await check();
    if(this.revision(id)!==revision)throw new Error('Operation changed during release check');
    this.validateCompletion(id,proof);return proof;
  }
  async release(id:string,check:()=>Promise<CompletionProof>):Promise<RecordView> {
    const revision=this.revision(id),proof=await check();
    return this.atomic(()=>{
      if(this.revision(id)!==revision)throw new Error('Operation changed during release check');
      this.validateCompletion(id,proof);
      this.db.prepare('INSERT INTO completion_releases(parent_id,proof) VALUES(?,?) ON CONFLICT(parent_id) DO UPDATE SET proof=excluded.proof').run(id,JSON.stringify(proof));
      this.db.prepare('UPDATE intents SET released=1 WHERE id=?').run(id);
      this.event(id,'COMPLETION_RELEASED',proof);
      return this.get(id)!;
    });
  }
  close(): void { if (!this.closed) { this.db.close(); this.closed = true; } }
}

