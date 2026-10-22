# Live fault test: lost response → kill → restart → recovery → cancel

22 October 2026. Explicitly authorized on Somnia testnet, chain 50383, using paper USDso/STT.

## Sequence

1. Fresh RPC preflight: signer 4.98485825 STT; free margin 1000 USDso, Healthy, position 0; place/cancel allowed; latest/pending nonce 2; simulation succeeded.
2. POST_ONLY BUY 0.004 ETH at 2276.72 USDso, notional 9.10688 USDso. New ID `orderanchor-crash-20261022`, separate private crash-cycle.sqlite.
3. SQLite committed signed bytes, hash and nonce before broadcast, then UNKNOWN before transport.
4. RPC accepted `0xd7cd945ed7bc1792d71f101558c933679790bf7a3d650673851c7e3194b7a63b`. The fault wrapper saw the correct hash but did not return it to the executor. Node child PID 21424 killed itself with SIGKILL without finally/Store.close. Before restart, Get-Process confirmed that PID no longer existed. A separate child exit code was not recorded.
5. New Node PID 24672 reopened the same database: UNKNOWN and the same persisted hash. Its recovery branch did not prepare or broadcast a placement; resume read the transaction/receipt and checked exact identity.
6. Placement receipt succeeded in block 30325711, nonce 2; orderId `5331109037302068704547`. The order remained OPEN.
7. After renewed permission, nonce, STT and simulation checks, cancellation was signed and committed: `0x2d1ac08d99b7bac83fb84ba44a2c28346f2a03451cfb795aa89d346e05b01523`, nonce 3. Receipt success in block 30326076 with exact OrderCancelled.
8. Lifecycle block 30326095: CANCELLED, filled 0, remaining 0, position 0. Margin block 30326133: unlocked 1000 USDso, locked 0, Healthy.

## No repeated placement

- One UNKNOWN event with phase broadcast-attempted for placement.
- One recorded fault-transport send; the restart branch contains no place-send call.
- The persisted hash did not change across restart.
- On-chain nonces were place 2 and cancel 3; latest=pending=4 afterwards. No additional mined or pending signer nonce appeared between these actions.
- These observations establish no duplicate in this controlled run, not universal exactly-once execution under every network failure.

## Evidence

- [Full crash cycle](../evidence/crash-cycle-2026-10-22.json): preflight, process IDs, fault marker, restart identity, journal, receipts, lifecycle and account state.
- [Placement receipt](../evidence/crash-place-receipt-2026-10-22.json).
- [Cancellation receipt](../evidence/crash-cancel-receipt-2026-10-22.json).
- [Nonce and gas summary](../evidence/crash-summary-2026-10-22.json).

Private SQLite, signed bytes and the DPAPI key are excluded. Gas cost: **0.007849722 STT**; remaining signer balance **4.977008528 STT**.

## Reproduction and limits

scripts/live-cycle.ts --fault-child requires a new database and fresh preflight. --recover-cancel requires the existing database and accepted-hash marker; it recovers by reading and can sign only the cancellation. The key is supplied through local stdin. These modes perform real testnet actions and require separate explicit authorization; they are not part of the read-only reviewer walkthrough.

The fault was locally injected after a positive RPC response, not a real provider outage. This tested a crash after placement acceptance, not every kill point, live reorg, replacement or external writer. TypeScript and 30 tests passed before the run. Independent verification and the interface were subsequent stages.
