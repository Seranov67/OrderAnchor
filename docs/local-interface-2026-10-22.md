# Local OrderAnchor interface

Open **http://127.0.0.1:4317** after running from the project root:

```powershell
npm.cmd run ui
```

For private SQLite journals, use the Windows profile that owns them. The submission intentionally omits those journals: the interface still works with public evidence and explicitly marks the private journal unavailable. Ctrl+C stops a manually launched server; a second process refuses to take an occupied port.

## Features

- Two configured cycles: Normal cycle and Crash recovery.
- Owner/signer, orderId, place/cancel hashes and nonces, parameters, timestamped observation, fills/remaining and scoped duplicate check.
- Private journal reads use readOnly/query_only and select only public fields, never signed bytes. Busy/unavailable SQLite is explicitly distinguished from public archive data.
- Recover via RPC runs the independent verifier, reconstructs hashes and checks canonical receipts, current order, event history and nonce bounds. A derived observation is saved under data/ui; the original journal is not rewritten. Recovery reconstructs network state rather than repeating an operation.
- FAILED/UNAVAILABLE replaces a fresh VERIFIED claim when RPC verification fails. Saved observations are timestamped, not presented as continuous live monitoring.
- Export one or both cycles as portable evidence/v1 JSON using the same allowlist/schema. No keys, signature fields or serialized signed transactions. The CLI verifier independently checks the export.

## Local access boundary

The server listens only on 127.0.0.1. Host/Origin/token/Fetch-Site checks, CSP, no-store and iframe denial are enabled. API input is limited to two known operation IDs, never arbitrary filesystem paths. One recovery runs at a time; concurrent requests receive 409. There are no endpoints for keys, signing, place, cancel, rebroadcast, unlock, arbitrary files or shell commands.

This is a local prototype, not a multi-user remote service. The cycle list is fixed in src/local-ui.ts. API network activity consists of reads, not blockchain transactions. The UI does not load private keys.

## Validation

TypeScript and 44 tests passed at this checkpoint. HTTP coverage includes field allowlisting, denied secret paths, valid export, Host/Origin/token protections, concurrent recovery and observation persistence. Both cycle selection and actual RPC recovery were checked in the browser. The later English-language update and completion gate brought the suite to 53 tests.
