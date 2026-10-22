# GitHub publication preparation

Prepared locally on 22 October 2026. No repository has been published, no remote configured and no contest form submitted by this step.

## Reviewed publication source

Use the extracted `OrderAnchor-submission-2026-10-22-v3.zip` as the future repository source. The development workspace also holds private journals and unrelated local material; the archive is assembled from an explicit allowlist rather than a copy of the whole workspace.

The package includes source, tests, UI, clean startup instructions, pinned dependencies, English documentation, submission drafts, public evidence, third-party notices and integrity reports. Test accounts are generated at runtime; no fixed funded private key is shipped. Wallet-generation and live-harness source is included for inspection, not automatically executed by installation, tests or the UI.

## Excluded material and checks

- Private wallet storage, keys, keystores, recovery phrases and environment files.
- Private SQLite databases, WAL/SHM/journal files and runtime observations.
- Installed dependencies, caches, service logs, temporary files and internal research.
- Unreviewed screenshots and evidence files outside the public allowlist.

The package builder rejects private path/file types, symlinks, embedded key/recovery-phrase literals and recognizable credential token formats. Public evidence JSON is recursively checked for private-key, signature and broadcastable-transaction fields. Source references to key-handling APIs are necessary implementation code, not stored credentials. Transaction hashes and public account addresses remain public evidence.

The final ZIP is checked against the manifest byte lengths and SHA-256 digests, read back entry by entry and checked for CRC errors. Clean installation, TypeScript checking, the test suite and public-evidence UI/export smoke checks are recorded in `PACKAGE-CHECKS.json`. `MANIFEST.json` lists payload hashes, excluding itself; the ZIP checksum is distributed separately. Checksums establish integrity, not authorship or a guarantee that arbitrary future edits are safe.

The `.gitignore` excludes private storage and uses an allowlist for public evidence. Before any future commit, review staged paths and diff again. Do not copy local private journals into the repository. Validation generates new temporary test databases and dependencies locally; those generated files are excluded from the ZIP and Git.

## Remaining publication decisions

Public repository owner/name, team/contact details and publication approval remain pending. The README includes an honest pending “X posts” section; replace it with actual published links only after approval. No license has been invented for the project: confirm the intended license before advertising open-source licensing. Existing third-party notices must be retained.

See [contest readiness](CONTEST-READINESS-2026-10-22.md) and [form/post drafts](SUBMISSION-FORM-DRAFT.md) for the remaining contest tasks. Rebuild the archive after future content changes so the manifest matches the published snapshot.
