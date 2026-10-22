# Independent verifier and testnet evidence export

22 October 2026. This stage created no new transaction: no key or private SQLite was opened and no sign/send was called. Public facts were independently reread from RPC.

## Results

| Cycle | Hash/signer | Receipts | Order | Fills | Historical nonce interval | Result |
|---|---|---|---|---|---|---|
| Normal place → cancel | Both hashes recomputed; signer recovered | Successful, canonical, matching archive | CANCELLED; remaining 0 | 0 | 0 → 2: place 0, cancel 1 only | VERIFIED |
| Crash → restart → cancel | Both hashes recomputed; signer recovered | Successful, canonical, matching archive | CANCELLED; remaining 0 | 0 | 2 → 4: place 2, cancel 3 only | VERIFIED |

Snapshots were blocks 30330508 and 30330625. Receipt gas costs, 0.01514175 and 0.007849722 STT, belong to the original cycles; the verification itself spent no transaction gas.

## Artifacts

- [Portable export](../evidence/testnet-cycles-export-v1.json).
- [Fresh independent verification](../evidence/testnet-cycles-verification-2026-10-22.json).
- [Historical verifier test run](../evidence/verifier-tests-2026-10-22.tap).

Bundle SHA-256: `a15881255c99cc5f60b7ee6a2c42d13132e768886ff6468deeb32fa4365eff32`.

## Checks

src/evidence.ts does not depend on OperationStore, executor, resume or cached COMPLETE/verified flags. It validates schema v1, allowed fields, checksum, unique IDs/hashes, immutable intent and placement/cancellation pairing.

Fresh RPC signature fields are used only in memory to reconstruct the EIP-1559 envelope, recompute keccak256 and recover the signer. Chain 50383, nonce, from/to, zero value and exact POST_ONLY placeOrderFor/cancelOrderFor calldata are checked. Signatures and serialized bytes are not exported.

Receipts require canonical blocks and at least two confirmations. Archived receipt fields and logs are compared against fresh RPC. OrderPlaced must match the intent and cancellation must emit exact OrderCancelled. Complete pool history plus getOrderOnchain establish one placement, one cancellation, absent order and no fills/reduce. Logs are read in bounded block chunks without relying on an indexer; canonical anchors are reread at the end.

Signer nonce before the placement block and at the end of the cancel block must increase by exactly two and match the two verified consecutive nonces. This excludes another mined signer transaction within that interval, not every send attempt or activity by other signers outside it.

## Repeat without secrets

```powershell
npm.cmd run evidence -- verify evidence/testnet-cycles-export-v1.json evidence/reverification-new.json
npm.cmd run evidence -- export evidence/live-cycle-2026-10-22.json evidence/new-export.json evidence/crash-cycle-2026-10-22.json
```

Use new output filenames; existing evidence is not overwritten. Pinned dependencies and RPC access are required; keys, private SQLite and DPAPI are not. Unavailable reads yield UNAVAILABLE with nonzero exit; violated checked invariants yield FAILED. Unknown schema/checksum fails before RPC. An incomplete result never becomes VERIFIED.

## Validation and limits

Strict TypeScript and 39 tests passed at this historical checkpoint. Nine new tests covered allowlists/schema/checksum, duplicate records, hash/signature reconstruction, changed intent, altered receipt even after recomputing the checksum, reorg/revert, missing history, active order, extra nonce, duplicate logs and unavailable RPC.

RPC is the trust source, not an independent consensus light client. SHA-256 verifies integrity, not authorship. Process IDs, kill/restart and send counts remain local crash-test evidence. UI and safe-release behavior were implemented in later stages.
