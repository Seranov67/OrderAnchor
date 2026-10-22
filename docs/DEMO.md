# OrderAnchor — Demo and Evidence Guide

## Purpose

An RPC timeout does not tell a trading bot whether its transaction landed. Blindly placing again can create a duplicate order. OrderAnchor persists the signed transaction and hash before sending, records uncertainty, then recovers the original operation from the chain after restart.

This MVP targets dreamDEX Perps on Somnia testnet. It focuses on recovery and verifiable outcomes rather than a trading strategy.

## Three-minute walkthrough

1. Run `npm.cmd run ui` and open http://127.0.0.1:4317.
2. Select **Normal cycle**. Inspect place/cancel hashes, order ID and the local journal.
3. Select **Crash recovery**. Observe UNKNOWN followed by confirmation recovered using the same saved hash.
4. Click **Recover via RPC**. The app recomputes hashes, recovers the signer, compares archived and canonical receipts, and checks order history and nonce bounds. No new transaction is sent.
5. Inspect **CANCELLED**, **0 / 0**, the scoped duplicate check and the observation timestamp.
6. Download **Export JSON** or **Export both cycles**. Independently verify the file with the CLI, without the private journal or key.

The normal and crash scenarios already ran on testnet. This walkthrough only views, reads, verifies and exports their evidence.

## Recorded transactions

| Cycle | Placement | Cancellation |
|---|---|---|
| Normal | `0x27337193dbead091eeac8faa881561aeb01f978a7004e0f27e188b5d7b473793` | `0xe3e312c7c830464bb7087a1a6acda21efd05cfb911fc0522cf9e836e63fa3006` |
| Crash recovery | `0xd7cd945ed7bc1792d71f101558c933679790bf7a3d650673851c7e3194b7a63b` | `0x2d1ac08d99b7bac83fb84ba44a2c28346f2a03451cfb795aa89d346e05b01523` |

Both used POST_ONLY bids of **0.004 ETH** on ETH-PERP. Both ended cancelled with zero fills, remaining quantity and position. Final free margin was **1,000 paper USDso**. Gas costs were **0.01514175 STT** and **0.007849722 STT**, respectively.

## Recovery evidence

Child process **21424** persisted the hash and UNKNOWN state. The fault wrapper saw RPC acceptance, withheld the response from the executor and killed that process. Process **24672** reopened the same database, recovered the same hash and order ID by reading RPC, then submitted only the cancellation.

Historical signer nonces were **0 → 2** for the normal cycle and **2 → 4** for the crash cycle. Each interval contains exactly the verified place and cancel. This excludes an additional mined transaction by that signer within those intervals. It does not establish unsuccessful send-attempt counts or activity by other signers.

## Safe continuation

Confirmation alone does not free the signer slot. Release requires a fresh cancellation proof with no fills or remaining quantity, zero position and locked collateral, no active perp pools, a healthy account, expected signer nonce and no pending transaction. The next operation must use the same owner/pool/signer lane and verified nonce.

Release is atomic and survives restart. Checks repeat before preparation and broadcast. A detected reorg of released history halts the signer. Filled, partially filled, expired, reverted or unresolved operations remain blocked under the conservative policy. Real demo locks were not automatically released during implementation.

## Reproduce checks

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run evidence -- verify evidence/testnet-cycles-export-v1.json evidence/reviewer-verification.json
```

Use a fresh output filename. Failed or unavailable verification exits with a nonzero code. No blockchain transaction is sent.

## Limitations

- Response loss was injected locally after RPC acceptance. This is one real testnet recovery scenario, not proof for every failure point or a real provider outage.
- RPC is trusted for network facts; there is no consensus light client.
- Release coordination covers one canonical SQLite database and dedicated signer.
- The local UI lists two configured demonstration cycles; arbitrary account onboarding is not implemented.
- Portable private-state backups and mainnet execution are outside this MVP.
- Public exports omit keys, signatures and serialized signed transactions. Private journals must remain private.
