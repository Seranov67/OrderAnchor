# Run OrderAnchor from the submission package

## Requirements

- Node.js **22.17.1** and npm. The built-in SQLite API is experimental in this version.
- A free local port **4317**.
- Internet access for dependency installation and optional RPC verification.

No wallet, private key, funded account or private database is needed to view the included public evidence or reverify it. The interface does not submit transactions.

## Windows PowerShell

Extract the ZIP to a new folder and open a terminal in the folder containing package.json:

```powershell
npm.cmd ci --ignore-scripts --no-audit --no-fund
npm.cmd run typecheck
npm.cmd test
npm.cmd run ui
```

Open **http://127.0.0.1:4317**. Keep the terminal running; press Ctrl+C to stop. If the port is occupied, stop the earlier OrderAnchor server rather than starting a second copy.

## macOS / Linux

Use the same pinned Node version and commands with `npm` instead of `npm.cmd`.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm test
npm run ui
```

## What to expect in a clean extraction

Both completed testnet cycles appear from public evidence. The private journal is explicitly unavailable because private databases are intentionally not distributed. This does not prevent public-evidence verification or JSON export. Saved statuses have timestamps; click **Recover via RPC** for a fresh read.

The UI reads the chain and writes derived observations under data/ui. Tests generate temporary fixture databases under tmp using random fixture keys. These newly generated local test files are not the funded bot wallet or original private journals.

## Verify without the interface

```powershell
npm.cmd run evidence -- verify evidence/testnet-cycles-export-v1.json evidence/reviewer-check.json
```

Use a new output name. RPC/archive-read failures yield an incomplete result and nonzero exit code, not a verified success. Existing archived evidence can still be inspected offline. Verification consumes no transaction gas.

## Archive integrity

MANIFEST.json lists the byte length and SHA-256 of every payload file. It excludes its own digest to avoid a self-reference. The separate ZIP checksum identifies the delivered archive. Neither digest is a digital signature or proof of author identity.

The optional live harness and wallet-generation source are included for inspection. Do not invoke them as part of this walkthrough: live modes are separately gated and are not required to judge the recorded demonstration.
