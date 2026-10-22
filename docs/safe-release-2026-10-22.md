# Safe release of the next operation

## Conservative policy

CONFIRMED describes transaction confirmation, not a free signer slot. Schema v4 adds released, completion_releases and persistent halted_signers.

Release requires freshly and independently verified placement/cancellation, exact hashes/intents/receipts, canonical blocks, CANCELLED state, fills=0 and remaining=0. A separate pinned MarginBank read requires position=0, lockedCollateral=0, no activePerpPools and Healthy status. The signer nonce must equal cancel.nonce+1 and pending must match. External/pending activity, uncertainty or RPC failure keeps the lock.

FILLED, EXPIRED, REVERTED, partially filled cancellation and manually closed positions do not automatically qualify. They need a separate reconciliation policy. REVERTED no longer silently frees a slot through the SQL index predicate.

## Durable gate and revalidation

OperationStore.release performs network reads outside its SQL transaction, then atomically checks journal revision, exact parent/cancel/hash/orderId and proof freshness within 30 seconds. The release flag, proof and COMPLETION_RELEASED event commit together or roll back together. Placement/cancellation history is preserved; state is not reset to SIGNED.

Release survives restart but is not a permanent trading permit. A fresh callback is required before the next prepare and again before broadcast. The nonce must match; the MVP supports the same owner/pool/signer lane only. The unique index prevents two next root intents occupying one signer slot. A released operation ID cannot be broadcast again.

If reconciliation returns released placement/cancellation to UNKNOWN, REVERTED or CONFLICT, the signer enters a persistent halt, blocking even an already-prepared next place. Restart does not clear it. There is no automatic force-unlock or history deletion.

## Commands

```powershell
npm.cmd run cli -- check-release <existing-db> <operation-id> evidence/testnet-cycles-export-v1.json
npm.cmd run cli -- release-next <existing-db> <operation-id> evidence/testnet-cycles-export-v1.json
```

check-release checks network eligibility and local identities without committing released; opening a legacy database can migrate its schema. release-next repeats the checks and changes only the local gate. It neither signs nor sends. Live signing/place/cancel CLI remains disabled.

scripts/check-completions.ts performs a dry-run for both public cycles without opening/migrating their private databases. See [dry-run evidence](../evidence/completion-check-2026-10-22.json).

## Scope

Continue one canonical SQLite per dedicated signer; do not create a new empty database to bypass history. The index/halt operate within that database, not every file or external bot. The two historical demo cycles used separate databases; strict nonce checks reject the stale first cycle as permission to continue. Only the latest consistent history qualifies. External writers and changes between the final read and send cannot be completely eliminated.

Schema v2/v3 migrates transactionally to v4. Multiple unresolved legacy records for the same signer make the new unique index refuse migration rather than silently declaring them complete.

## Tests and recorded check

TypeScript and 53 tests passed. Coverage includes release/reopen, fresh prepare/broadcast guards, stale/mismatched proofs, exposure/fills/pending nonce, unknown cancellation, RPC failure, journal races, atomic rollback, competing root intents, nonce/owner mismatch, old-ID replay, placement/cancel reorg halts and halt persistence. proveCompletion is also exercised with independent verification, unhealthy/nonempty account and missing history.

Tests use random fixture keys and mock transport. No new network transaction or real demo release was committed in this stage. The read-only dry-run found the latest crash cycle eligible at block 30341265: all exposure fields zero, activePools=0, latest=pending=4. The first cycle was ineligible. localReleaseCommits=0 and networkWrites=0. That saved proof cannot be reused later without a fresh check.
