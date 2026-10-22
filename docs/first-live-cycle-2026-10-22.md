# First controlled testnet place → cancel

22 October 2026. Explicitly authorized by the user. Chain 50383; testnet paper USDso and STT.

## Results

- Trading owner, OrderAnchor Test: `0xCf0a0858C6F6e81e553E580af6617aa128E96533`.
- Bot signer: `0xa50a0cC153807a86e55A613f327Be6752CdeB389`.
- ETH-PERP POST_ONLY BUY 0.004 ETH at 2274.55 USDso; notional 9.0982 USDso.
- Order ID: `13004954571965242175743`.
- Place nonce 0: `0x27337193dbead091eeac8faa881561aeb01f978a7004e0f27e188b5d7b473793`, successful receipt in block 30323637.
- Cancel nonce 1: `0xe3e312c7c830464bb7087a1a6acda21efd05cfb911fc0522cf9e836e63fa3006`, successful receipt in block 30323737.
- Lifecycle snapshot 30323756: CANCELLED, filled 0, remaining 0. Exact OrderCancelled, canonical receipts and chain read-back with two confirmations were checked.
- Position 0. Margin snapshot 30323792: unlocked 1000 USDso, locked 0, Healthy.
- Combined gas cost 0.01514175 STT. Remaining signer balance 4.98485825 STT.

## Evidence

- [Complete cycle](../evidence/live-cycle-2026-10-22.json): preflight, raw/human intent, hashes, receipts, cancel plan, lifecycle, account state and journal events.
- [Placement receipt](../evidence/live-place-receipt-2026-10-22.json).
- [Cancellation receipt](../evidence/live-cancel-receipt-2026-10-22.json).
- The private first-cycle.sqlite and its signed bytes are deliberately excluded from the submission.
- scripts/live-cycle.ts requires an explicit execution flag, fresh successful preflight and a key through stdin. An existing cycle database blocks a new placement.

Hashes and signed payloads were committed before broadcast. Cancellation had fresh lifecycle, permission, nonce, fee and simulation checks. Each transaction had one send attempt; there were no hidden retries. The DPAPI key stayed local and was not printed or exported.

## Scope

This proves the normal G3 live cycle. No response was hidden and no process was killed in this run. G4 was a separately authorized later test. The completed operation's durable lock was conservatively retained; a later implementation added explicit safe release without automatically committing release for these demo databases.
