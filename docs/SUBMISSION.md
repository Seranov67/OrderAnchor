# OrderAnchor — submission overview

## Project summary

OrderAnchor is a local recovery and evidence tool for dreamDEX Perps. It preserves transaction identity before sending, recovers an uncertain operation after process restart, and verifies the final order outcome without blindly placing again.

## Problem

A timeout can occur after RPC has accepted a transaction. A trading bot that interprets the timeout as failure can submit a second order. A successful receipt alone also does not prove that an order is still open, fully cancelled, or free of partial fills.

## Implementation

TypeScript/Node.js with the official markets SDK and viem; SQLite WAL/FULL journals; pre-broadcast local EIP-1559 hash; explicit UNKNOWN state; separate placement/cancellation identity; read-only reconciliation; independent receipt/order verifier; portable public JSON exports; local English UI; conservative completion-gated continuation.

## Demonstrated evidence

- One normal live testnet POST_ONLY place/cancel cycle.
- One live testnet cycle where the local wrapper hid a positive RPC response, killed the child process, and recovered the same hash after restart without another placement.
- Successful cancellation, zero fills and zero position in both cycles.
- Independent reconstruction of all four transaction hashes/signers, canonical receipt checks, current order checks and scoped historical nonce verification.
- Safe-release implementation and tests; actual demo database releases were not automatically committed.

See [the demo guide](DEMO.md), [public export](../evidence/testnet-cycles-export-v1.json), [verification report](../evidence/testnet-cycles-verification-2026-10-22.json) and [startup instructions](../RUN.md).

## What is included

Application source, local UI, CLI and explicit live-harness source, tests/fixtures, pinned package files, English documentation, public OrderAnchor evidence, third-party notices and a payload integrity manifest. No installed dependencies are shipped.

The package excludes private keys/keystores, seed phrases, private SQLite databases and sidecars, runtime observations, temporary source snapshots, local service logs, Git metadata and caches. Only evidence relevant to the OrderAnchor demonstration is included.

## Boundaries

The fault was locally injected after RPC acceptance, not a real provider outage. This proves a particular controlled recovery scenario, not global exactly-once behavior. RPC is trusted for chain facts. Nonce checks establish no additional mined signer transaction only within the stated cycle intervals. Process termination and send-attempt counts are local evidence.

Release safety is scoped to one canonical database and dedicated signer. Mainnet, multi-user onboarding, automatic replacement/rebroadcast and portable private-state backups are outside this MVP. No claim of contest-wide uniqueness or accepted SDK bug is made.

## Submission status

This package is prepared locally for review. It has not been uploaded, published as a repository, posted on social media, or submitted through the contest form by this preparation step. See the [requirements checked on 22 October 2026](CONTEST-READINESS-2026-10-22.md) and [English form draft](SUBMISSION-FORM-DRAFT.md). Public GitHub and X-post links and submission whitelist access remain pending. Historical planning dates are not a statement of current eligibility. The v3 package includes both draft documents and the publication preparation guide.
