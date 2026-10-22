# Controlled place → cancel cycle: local readiness

Historical implementation checkpoint, 22 October 2026, before the live cycles. No network transaction was signed or sent during this checkpoint. Tests used temporary random fixture keys; the funded bot key was not loaded. Later live results are documented separately.

## Implemented

- SQLite schema v3 with transactional migration from v2. A cancellation record references its placement and stores immutable orderId, hash, nonce, private signed bytes and state. The record and event commit atomically.
- One cancellation per root intent. Preparing the same hash is idempotent; a different payload/nonce conflicts. UNKNOWN cancellations cannot be automatically resent. At this checkpoint, the root remained locked even after cancellation.
- The cancel broadcast primitive commits UNKNOWN before transport, attempts one send and checks the returned hash. It is a library primitive, not an enabled live CLI command.
- Read-only resume-cancel checks from/to/data/value/nonce/chain, canonical receipt, two confirmations and exactly one matching OrderCancelled event. Receipt success alone does not prove cancellation.
- Lifecycle combines getOrderOnchain with complete pool events from the placement block through the snapshot. It checks the placement anchor, order identity, quantities, fills and terminal events. OPEN/PARTIAL/FILLED/CANCELLED/EXPIRED are distinct from REMOVED_UNKNOWN/UNKNOWN/CONFLICT. CANCELLED does not conceal partial fills.
- A missing order without terminal evidence remains REMOVED_UNKNOWN with remaining=null. An external reduce leaves UNKNOWN because its accounting is outside the first-cycle policy.
- plan-cancel refreshes placement/lifecycle, permission, dedicated-signer nonce, STT, eth_call, estimateGas and a 0.1 STT ceiling. It creates neither a signature nor a cancellation record.

## Network-read-only commands

```powershell
npm.cmd run cli -- status <existing-db> <operation-id>
npm.cmd run cli -- inspect-order <existing-db> <operation-id>
npm.cmd run cli -- plan-cancel <existing-db> <operation-id>
npm.cmd run cli -- resume-cancel <existing-db> <operation-id>
```

Missing databases are not silently replaced. Observations and reconciliation may be persisted locally. Status exposes placement and cancellation separately, without signed bytes.

## Validation

Strict TypeScript and 30 tests passed at this checkpoint: fixture cycle, unknown cancel after reopen without resend, immutable cancellation, nonce reuse, missing order, foreign cancel, expiry, partial fill plus cancel, full fill, reorg, absent placement anchor, duplicate logs, receipt identity/confirmation/event, v2 migration and planner guards.

## Boundaries

The live harness must perform fresh preflight → durable place → receipt → lifecycle → fresh cancel plan → local signing and durable cancel → receipt → lifecycle. Low-level broadcast is not a substitute. Already-filled or unresolved orders must not produce an invented successful cancellation; any resulting position needs a separate decision.

Lifecycle snapshots require two confirmations and refuse history older than the adapter's 20,000-block window. Longer verifier history, safe release and live crash recovery were subsequent work; see the later reports rather than treating these historical limitations as the current project status.
