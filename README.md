# OrderAnchor

[GitHub repository](https://github.com/Seranov67/OrderAnchor) · [Offline checks](https://github.com/Seranov67/OrderAnchor/actions/workflows/checks.yml)

Recover the outcome of a dreamDEX Perps operation after a lost RPC response or process restart, without placing the same order again.

OrderAnchor is a local prototype for developers who need to answer: **Did my transaction land, what happened to the order, and is it safe to continue?**

## Demo video

[Watch / download the English demo v2 (MP4, 1m 38s)](https://github.com/Seranov67/OrderAnchor/raw/refs/heads/main/media/demo-v2/OrderAnchor-demo-en-v2.mp4) · [Subtitles and transcript](media/demo-v2/README.md)

[![Successful read-only recovery](media/demo-v2/successful-recovery.png)](https://github.com/Seranov67/OrderAnchor/raw/refs/heads/main/media/demo-v2/OrderAnchor-demo-en-v2.mp4)

Fresh independent CLI verification confirms both recorded cycles; the UI confirms the crash cycle as **VERIFIED / CANCELLED, 0 filled / 0 remaining**. The demo is an edited walkthrough with genuine app captures and English narration. It rereads the existing transactions; no new orders or cancellations were sent while recording. [Fresh verification report](evidence/rpc-history-verification-2026-10-22-v2.json) · [UI observation](evidence/rpc-history-ui-recovery-2026-10-22-v2.json).

## Run the local demo

Requires Node.js **22.17.1**. SDK **0.32.1** and viem **2.54.1** are pinned in the lockfile.

```powershell
npm.cmd ci --ignore-scripts --no-audit --no-fund
npm.cmd run ui
```

Open **http://127.0.0.1:4317**. Inspect both completed testnet cycles, their transaction hashes and journals. **Recover via RPC** checks current network facts. **Export JSON** downloads portable public evidence. No wallet connection or private key is required to verify public evidence.

The original private SQLite journals are accessible only to their owning Windows profile. When unavailable, the UI explicitly shows public evidence instead. All saved observations display their timestamp.

## Demonstrated on testnet

| Scenario | Result |
|---|---|
| Normal POST_ONLY place → cancel | Confirmed, cancelled, zero fills and position |
| Accepted place → hidden response → forced termination → restart | Same persisted hash recovered from UNKNOWN; no second place; remaining order cancelled |
| Independent verification | All four hashes reconstructed, signatures checked, canonical receipts matched, both orders cancelled |
| Safe next-operation release | Implemented and tested; fresh completion checks before release, preparation and broadcast |

The fault was injected locally after RPC acceptance. This demonstrates one recovery path, not a universal exactly-once guarantee or a real provider outage. Assets were testnet paper USDso and STT on chain **50383**.

## Independently verify evidence

```powershell
npm.cmd run evidence -- verify evidence/testnet-cycles-export-v1.json evidence/new-verification.json
```

Use a new output filename. Verification only reads RPC. It checks exact calldata, recovered signer, nonce, canonical receipts, order events, remaining state and historical nonce bounds. Network failures remain incomplete rather than VERIFIED.

Exports exclude private keys, signatures and broadcastable transaction bytes. SHA-256 detects changes, not author authenticity. RPC is the trust source, not a consensus light client. Process termination and send-attempt counts are local evidence; the chain proves mined identities and nonce intervals.

## Architecture and safe continuation

`Local UI / CLI → SQLite journal → testnet adapter → reconciliation → independent verifier → public evidence`

Signed bytes and the local hash are committed before broadcast. UNKNOWN is persisted before transport; response loss does not trigger a hidden retry. Recovery reads the original hash. Cancellation and order lifecycle are tracked separately.

The signer slot is released only after a fresh zero-fill cancellation proof, empty account exposure and expected nonce. Checks repeat before the next prepare/send; detected reorgs halt the signer. Release is scoped to one canonical database and dedicated signer, not unrelated files or external bots.

The UI exposes no signing, placement, cancellation, rebroadcast or unlock endpoint. Live test harnesses require separate explicit authorization. Mainnet and portable private-state backups are outside this MVP.

## Validation

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run cli -- help
```

All 63 tests pass locally. The suite covers durable commits, restart recovery, cancellation, partial fills, evidence tampering, unavailable RPC, release guards, reorg halts and local API protections. Order history uses indexed order-ID queries for both maker and taker fills while retaining full block coverage. See the [RPC history fix and fresh verification](docs/rpc-history-fix-2026-10-22.md). The pinned Node version marks node:sqlite experimental.

## Reviewer materials

![OrderAnchor local interface](evidence/orderanchor-english-ui-2026-10-22.png)

- [English demo and evidence guide](docs/DEMO.md)
- [Public evidence for both cycles](evidence/testnet-cycles-export-v1.json)
- [Fresh verification after the RPC fix](evidence/rpc-history-verification-2026-10-22-v2.json)
- [Original independent verification results](evidence/testnet-cycles-verification-2026-10-22.json)
- [Crash/restart evidence](evidence/crash-cycle-2026-10-22.json)
- [Safe-release dry-run](evidence/completion-check-2026-10-22.json)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

All submission documentation is available in English. Start with [the submission overview](docs/SUBMISSION.md), [clean startup instructions](RUN.md) and the demo guide. Historical checkpoints retain their dates and evidence boundaries. The submission package excludes secrets, private SQLite files, runtime data, temporary sources and installed dependencies.

## Repository preparation

The public repository is [https://github.com/Seranov67/OrderAnchor](https://github.com/Seranov67/OrderAnchor). Its initial commit publishes the 87 files from the verified v3 submission archive; subsequent documentation updates add public links and refresh the manifest. See [publication preparation](docs/GITHUB-PREPARATION.md) for provenance and validation. The three X posts are published and linked below. Contest submission remains pending.

## X posts

Published by `@donnydan3` and checked on 22 October 2026. All three posts mention OrderAnchor and tag `@DreamDEXSomnia`.

1. [Project introduction](https://x.com/donnydan3/status/2113332274603368682)
2. [Demo v2: read-only recovery and JSON export](https://x.com/donnydan3/status/2113332347135201321)
3. [Testnet evidence and verification](https://x.com/donnydan3/status/2113332451095261410)

See the [submission form draft](docs/SUBMISSION-FORM-DRAFT.md) and [dated contest readiness checklist](docs/CONTEST-READINESS-2026-10-22.md).
