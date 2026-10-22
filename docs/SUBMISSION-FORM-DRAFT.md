# OrderAnchor — submission form draft

Prepared on 22 October 2026. The project repository and three entrant-authored X posts are public; this form text remains a draft and the contest form has not been submitted. The exact form fields and character limits have not been inspected beyond the organizer disclaimer. Adapt the sections below to the actual form.

## Name

OrderAnchor

## Track and category

MVP — Trader tools

## Tagline

Recover uncertain dreamDEX Perps transactions after restart without blindly placing another order.

## Short description

OrderAnchor is a local recovery and evidence tool for dreamDEX Perps bot developers. It saves transaction identity before broadcast, recovers an uncertain operation using its original hash, checks the resulting order state, and exports independently verifiable public evidence. Two real Somnia Tokyo testnet cycles demonstrate normal placement and cancellation, plus recovery after locally injected response loss and process termination.

## Full description

An RPC timeout does not tell a trading bot whether its transaction was accepted. Retrying placement can create a second order, while a successful transaction receipt alone does not establish the final order outcome. OrderAnchor helps developers answer three questions: did the transaction land, what happened to the order, and is it safe to continue?

Before broadcast, OrderAnchor commits the operation, signed transaction and locally calculated hash to a durable SQLite journal. It records an uncertain state before transport. After a lost response or restart, reconciliation reads the original hash instead of issuing another placement. Placement, cancellation and order lifecycle are tracked separately.

The English local interface lets reviewers inspect operations, run read-only RPC recovery and export public JSON evidence. A separate verifier reconstructs transaction hashes and signers from RPC data, compares canonical receipts and order events, and checks current order state and scoped nonce intervals. Public exports exclude private keys, signatures and broadcastable signed transaction bytes.

We demonstrated two real ETH Perps POST_ONLY place-to-cancel cycles on Somnia Tokyo testnet, chain 50383. In the second cycle, a local wrapper hid an accepted RPC response and the executor process was terminated. A restarted process recovered the persisted hash without another placement, then cancelled the remaining order. Both cycles ended with zero fills, no remaining order quantity and zero position. Four transaction hashes and public verification reports are included.

Conservative continuation guards require fresh completion evidence, zero exposure and the expected nonce before the next operation can proceed. The implementation has 63 passing local tests covering recovery, cancellation, evidence verification, indexed history reads and continuation guards. The public repository includes the indexed history fix, successful English demo v2 and fresh read-only evidence. Live release of the demonstrated signer slot has not been committed.

OrderAnchor is built with TypeScript, Node.js, the markets SDK, viem and SQLite. Its repeat-use workflow is inspect, recover, verify and export for each uncertain operation. It is a local developer prototype, not a trading strategy or a mainnet service. Response loss was injected locally; this demonstration does not establish a universal exactly-once guarantee. RPC remains the source of chain facts, and continuation safety assumes one canonical journal and a dedicated signer. Somnia Reactivity and Somnia Agents are not used in this version.

## How reviewers can run it

Use Node.js 22.17.1 and the committed lockfile:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run ui
```

Open http://127.0.0.1:4317. Public evidence can be inspected without a wallet, private key or private database. See [RUN.md](../RUN.md) for verification commands and [DEMO.md](DEMO.md) for the walkthrough.

## Demonstration transactions

| Cycle | Action | Transaction hash |
|---|---|---|
| Normal | Place | `0x27337193dbead091eeac8faa881561aeb01f978a7004e0f27e188b5d7b473793` |
| Normal | Cancel | `0xe3e312c7c830464bb7087a1a6acda21efd05cfb911fc0522cf9e836e63fa3006` |
| Response loss and restart | Place | `0xd7cd945ed7bc1792d71f101558c933679790bf7a3d650673851c7e3194b7a63b` |
| Response loss and restart | Cancel | `0x2d1ac08d99b7bac83fb84ba44a2c28346f2a03451cfb795aa89d346e05b01523` |

See the [public evidence bundle](../evidence/testnet-cycles-export-v1.json) and [independent verification report](../evidence/testnet-cycles-verification-2026-10-22.json). Saved observations are dated; current state must be checked again through read-only RPC when needed.

## Links to fill before submission

- Public GitHub repository: [https://github.com/Seranov67/OrderAnchor](https://github.com/Seranov67/OrderAnchor).
- Demo: [English video v2, 1m 38s](https://github.com/Seranov67/OrderAnchor/raw/refs/heads/main/media/demo-v2/OrderAnchor-demo-en-v2.mp4) · [Transcript, subtitles and evidence guide](https://github.com/Seranov67/OrderAnchor/blob/main/media/demo-v2/README.md).
- X posts: three published posts by `@donnydan3`, each tagging `@DreamDEXSomnia`; verified on 22 October 2026 and linked below.
- Team/contact and registration reward wallet: confirm in the actual form; do not substitute a bot wallet automatically.

## Published X posts

1. [Project introduction](https://x.com/donnydan3/status/2113332274603368682)
2. [Demo v2: read-only recovery and JSON export](https://x.com/donnydan3/status/2113332347135201321)
3. [Testnet evidence and verification](https://x.com/donnydan3/status/2113332451095261410)

All three posts were supplied by the entrant and verified on their public X pages on 22 October 2026. The agent did not publish or edit these X posts.
