# GitHub publication preparation

Published on 22 October 2026 at [https://github.com/Seranov67/OrderAnchor](https://github.com/Seranov67/OrderAnchor) with the user's authorization. The contest form has not been submitted.

## Reviewed publication source

The repository was initialized from a fresh extraction of `OrderAnchor-submission-2026-10-22-v3.zip`. The development workspace also holds private journals and unrelated local material; the archive is assembled from an explicit allowlist rather than a copy of the whole workspace.

The package includes source, tests, UI, clean startup instructions, pinned dependencies, English documentation, submission drafts, public evidence, third-party notices and integrity reports. Test accounts are generated at runtime; no fixed funded private key is shipped. Wallet-generation and live-harness source is included for inspection, not automatically executed by installation, tests or the UI.

## Excluded material and checks

- Private wallet storage, keys, keystores, recovery phrases and environment files.
- Private SQLite databases, WAL/SHM/journal files and runtime observations.
- Installed dependencies, caches, service logs, temporary files and internal research.
- Unreviewed screenshots and evidence files outside the public allowlist.

The package builder rejects private path/file types, symlinks, embedded key/recovery-phrase literals and recognizable credential token formats. Public evidence JSON is recursively checked for private-key, signature and broadcastable-transaction fields. Source references to key-handling APIs are necessary implementation code, not stored credentials. Transaction hashes and public account addresses remain public evidence.

The final ZIP is checked against the manifest byte lengths and SHA-256 digests, read back entry by entry and checked for CRC errors. Clean installation, TypeScript checking, the test suite and public-evidence UI/export smoke checks are recorded in `PACKAGE-CHECKS.json`. `MANIFEST.json` lists payload hashes, excluding itself; the ZIP checksum is distributed separately. Checksums establish integrity, not authorship or a guarantee that arbitrary future edits are safe.

The `.gitignore` excludes private storage and uses an allowlist for public evidence. Before any future commit, review staged paths and diff again. Do not copy local private journals into the repository. Validation generates new temporary test databases and dependencies locally; those generated files are excluded from the ZIP and Git.

## Publication provenance and remaining decisions

The public owner/name is `Seranov67/OrderAnchor`, with default branch `main`. The [initial commit](https://github.com/Seranov67/OrderAnchor/commit/3e56c9149f7205480be9ad5e2645cf22bffe3210) contains exactly the 87 verified v3 files. The source ZIP SHA-256 is `311e93efb2af8507e7a7bd0f71fa491170e6ccbb7a49192b2c8be3fb0428f528`; it is preserved unchanged. Follow-up documentation changes add public links and regenerate the repository manifest. Team/contact details remain to be confirmed for the contest form. The README includes an honest pending “X posts” section; replace it with actual published links only after approval. No license has been invented for the project: confirm the intended license before advertising open-source licensing. Existing third-party notices must be retained.

See [contest readiness](CONTEST-READINESS-2026-10-22.md) and [form/post drafts](SUBMISSION-FORM-DRAFT.md) for the remaining contest tasks. The repository manifest is refreshed after these documentation edits. Create a separately versioned archive after future content changes when a new ZIP is needed; do not silently replace the verified v3 archive.
