# OrderAnchor — selected MVP plan

Updated 22 October 2026. Current evidence: G0/G1 complete; durable place/cancel; successful G3 testnet cycle; G4 forced restart after hidden accepted response, same hash recovered without another place and remainder cancelled; G5 verifier/export VERIFIED for both cycles. Local UI and explicit safe release are implemented, with 53 tests. Portable private-state backup remains future work. Historical checkpoints below are not new claims about completed live edge cases.

## 1. Product decision

OrderAnchor is a local tool for recovering one dreamDEX Perps operation after response loss or restart. It persists intent/transaction before sending, reconstructs the outcome and indicates whether continuing is safe.

The first user is a bot developer or testnet trader facing an ambiguous timeout: What happened to this action, and can I act again? The MVP is deliberately narrow. Feedback is secondary and limited to new confirmed API/SDK/docs discrepancies found during integration. Profitability and report counts are not success criteria.

Core demonstration: small POST_ONLY → RPC acceptance with locally hidden response → forced process termination → restart → receipt/orderId recovery → no new place for that intent → verified cancellation or another established terminal outcome.

## 2. Implementation principles

Validate market rules, repeat preflight, simulate exact calls and verify receipts against actual order state. Separate owner and operator, use a dedicated signer and one controlled writer, enforce permissions/caps and pin dependencies. Persist unfinished operations before external actions. Check helper results and remaining quantity rather than treating normal function return as completion. Record exact versions, inputs and blocks; distinguish observed facts from hypotheses.

OrderAnchor focuses on durable unfinished-operation recovery with independently verifiable evidence.

## 3. Scope

| Initial MVP | Deferred |
|---|---|
| Hideki/Tokyo testnet 50383 | Mainnet/other networks |
| One owner, local dedicated bot signer, controlled writer | Hosted custody/multi-user/browser-wallet recovery |
| One market, ETH-PERP after live validation | Multi-market/batch |
| One active root intent, POST_ONLY plus related cancellation | Strategies, TP/SL, liquidation guard/copy trading |
| Durable intent/transaction/events and RPC reconciliation | Automatic nonce replacement/speed-up/rebroadcast |
| Actual fills/remaining and explicit uncertainty | Full PnL/funding accounting |
| CLI plus simple local status UI | Large dashboard/Telegram product |

The planned command surface included preflight/place/status/resume/cancel/export/verify. In the delivered prototype, live place/cancel require explicit harness authorization; the normal CLI/UI remains network-read-only. UI followed working recovery/verifier rather than substituting for them.

## 4. Technical choices

TypeScript/Node, official markets-sdk and viem. SDK supplies market/account/permission reads and checked decoding; viem supplies exact preparation, local signing and controlled transport. A helper hiding the hash until receipt completion is not the only sending boundary.

SDK 0.32.1, viem 2.54.1 and the lockfile passed peer/deduped install, strict consumer typecheck, offline signing and live read/decode checks. This did not establish every write path. Minimal For-method ABI came from the pinned official MIT bot kit; notices are retained. SDK already supports typed unknown/hash and an internal nonce lane; our addition is cross-process durability.

SQLite is authoritative local state; JSON is export. WAL, synchronous=FULL, foreign keys, schema validation and atomic state/event updates avoid split-file inconsistency. Missing/corrupt/unknown databases never silently reset. A future backup must be a coherent snapshot, not only copying the main file while WAL is live. Node 22.17.1/SQLite 3.50.0 are pinned; node:sqlite is experimental. Schema evolved from v2 to cancellation v3 and completion-gate v4.

Local EIP-1559 signing → keccak256(bytes) → recovered signer verification → durable commit precedes transport. Private keys never enter the journal/evidence. Signed bytes remain private because they authorize broadcast. ACLs, not gitignore alone, protect keys and journals.

## 5. Architecture/data

`UI/CLI → Executor → SQLite Store → dreamDEX adapter/RPC → Reconciler → Independent verifier`

| Module | Responsibility |
|---|---|
| CLI/UI | Explicit operation identity, facts, timestamps, unknowns |
| Adapter | Market/account/permissions, ABI, simulation, calldata, decoding |
| Executor | Commit/sign/send order, controlled writer, no hidden repeat |
| Store | Atomic intent/transaction/event/observation and durable gate |
| Reconciler | Hash/receipt/log/order/fill read-back; lag/reorg/conflict |
| Verifier | Schema and chain facts independent of cached verified flags |
| Fault harness | Locally hide responses or terminate only our process |

Store intent ID, chain/owner/signer/pool, exact raw parameters and state. Transactions carry nonce/hash/private signed bytes and receipt outcome; events record transitions; observations record dated network facts. Quantities use BigInt/decimal strings, not floating point for trading decisions.

Place and cancel are separate transactions under one root. Unknown transaction state blocks another root place. A known resting order permits controlled cancellation after reconciliation. Repeating one operation ID does not create another action; changed immutable parameters conflict. PID disappearance does not erase locks.

## 6. Execution/recovery sequence

1. Read chain, permissions, margin, gas, market geometry and fresh prices. Validate from/to/data/value plus fee ceiling, pin related reads where possible.
2. Reserve the dedicated signer intent and inspect latest/pending nonce. Unknown external activity blocks sending.
3. Sign the exact payload locally and commit signed bytes/hash before a network write. Commit failure means no transport call.
4. Commit broadcast-attempted/UNKNOWN, then send exactly those bytes and compare returned/local hashes.
5. Timeout/null/transport uncertainty retains UNKNOWN and blocks a new place. Timeout alone never proves nothing was sent.
6. Resume only reads: transaction/receipt, canonical blocks/logs, exact orderId and current fills/remaining. No new signature, nonce or automatic rebroadcast.
7. Transaction confirmation/revert and order lifecycle are separate. Missing receipt stays unknown; replacement/payload/external activity conflicts remain unresolved.
8. Cancellation uses its own durable hash/receipt and verified remainder/fills/position. Disappearance from open orders alone is insufficient.

Conceptual states were PREPARED → SIGNED → BROADCAST_ATTEMPTED → confirmation/revert, with UNKNOWN/CONFLICT. Actual prototype states are in src/store.ts. Two confirmations are a demo observation policy, not economic-finality proof. Changed block hash requires reconciliation; ambiguous identities are not guessed by matching price/time.

## 7. Initial eight-hour feasibility budget

| Gate | Budget | Exit criterion |
|---|---:|---|
| G0: access/wallet/funds | 45 min | Owner/signer, chain, STT/margin/permissions/gas or named blocker; submission access separate |
| G1: SDK/ABI/signing | 75 min | Pinned methods/versions, hash before send, SQLite reopen, usable operator calls |
| G2: durable core | 120 min | Intent/tx/event commit; restart; ID idempotency; no send after DB failure |
| G3: normal live cycle | 75 min | Own small POST_ONLY receipt/orderId/read-back plus cancellation/terminal proof |
| G4: main fault | 105 min | Accepted response hidden, actual process termination, restart without another place |
| G5: evidence/decision | 45 min | Minimal verifier/export, honest completed/unknown criteria |
| Buffer | 15 min | Resolve a blocker or document the remainder |
| Total | 8 hours | First feasibility proof, not a promise of a finished product |

Unfunded G3/G4 wait after 30–45 minutes; independent SDK/core work continues. User waiting is not active development. Whitelist access does not replace trading permission.

Continue if pre-send identity, real baseline and useful recovery are achievable or have a bounded fix. Otherwise narrow the promise or stop rather than expanding UI. Absence of an SDK bug is not a reason to abandon a useful product.

## 8. Follow-up estimate after a positive decision

Recovery/edge tests 4–5 hours; verifier/CLI 3–4; clean reproduction/docs/demo 3–4; submission materials/buffer 2–3. Additional 12–16 hours, preliminary total 20–24 active hours, not a measured commitment.

Terms read on 20 October listed 1 November 2026 23:59 UTC as the external deadline; the internal target was 31 October with 1 November as buffer. These historical dates/access requirements must be checked on the official event before submission. No reminder automation, repo publishing, X posts, messages or final Build submission were performed by this plan.

## 9. Required acceptance evidence

| ID | Scenario | Required outcome |
|---|---|---|
| A1 | Normal place/cancel | Own hashes, receipts/logs, exact orderId, fills/remaining, terminal state |
| A2 | Lost broadcast response plus restart | Persisted hash; same intent recovered; zero new place after fault |
| A3 | Kill after signed commit before send | Recoverable record; read-only resume sends nothing |
| A4 | Lost cancel response plus stale reads | Reconcile original cancel before another action; separate receipt/lifecycle |
| A5 | Null receipt/network error/unknown fills | UNKNOWN, no fake pass or unknown-to-zero conversion |
| A6 | Second writer/repeated ID | One writer; no extra business action |
| A7 | Missing/corrupt DB/failed commit | No broadcast and no silent replacement DB |
| A8 | Tampered evidence | Reject or leave unresolved wrong owner/target/chain/hash/payload/logs/verified-only JSON |
| A9 | Changed block hash/nonce conflict | Reconcile/conflict, not global exactly-once claims |
| A10 | Partial fill/external position change | Local fixtures required; live cases only if naturally controlled, never manufactured self-trading |

A2 needs an own live testnet cycle and real restart. A4 starts locally; any live extension stays within authorization/budget. Fault injection targets only our client/process, not network load. Schema validity, local integrity, chain transaction confirmation and lifecycle verification are distinct. No private keys/signed raw transactions/credentials belong in public exports. Offline checks must not be called live revalidation.

Product readiness and submission readiness differ: the latter also needs official access, current requirements, public materials and explicit final submission. Current reports establish live A1/A2 and the stated fixture coverage; do not infer unperformed live edge tests.

## 10. Current next steps

Core, both live cycles, independent verifier, local English UI and safe-release implementation/tests are complete within their documented limits. Prepare an English source/public-evidence package, validate a clean install and exclude all private state. Portable backups and broader account/market support remain future work. The [archived earlier plan](archive/plan-before-synthesis-2026-10-20.md) preserves pre-synthesis assumptions and detailed validator requirements.
