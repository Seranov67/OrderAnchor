# RPC history verification fix — 22 October 2026

## Root cause

The previous adapter fetched every ETH-PERP pool log in sequential 1,000-block ranges, from placement through the current confirmed snapshot. An unfiltered crash-cycle diagnostic accumulated 53,048 unrelated pool logs before the range 30,355,711–30,356,710 failed with `HTTP response body exceeded the size limit.` Individual earlier requests also took several seconds. The exact HTTP read-path limit is not attributed to a particular provider or client layer here.

This was a history retrieval failure, not an additional order, an absent receipt or a reason to retry placement. The UI correctly reported UNAVAILABLE rather than treating the prior successful observation as fresh.

## Implementation

`src/order-history.ts` now queries the same complete placement-to-snapshot block range with indexed order-ID filters. The first query covers every event with this order in the first indexed position, including taker fills. The second covers maker fills in the second indexed position. The pinned SDK ABI is tested to enforce this coverage assumption.

Two ranges run concurrently, with at most four RPC reads in flight. A failed history read gets one bounded read-only retry; a persistent failure still fails verification. Responses are checked against pool, range, topics and mined-log identity. Duplicate entries are rejected. A byte-identical fill matching both maker and taker queries is merged; conflicting overlap is rejected.

The CLI and UI now share the same read-only RPC adapter. Neither acquires a signing or broadcast capability. Canonical receipts, transaction reconstruction, signer, calldata, current order, nonce boundaries and reorg-anchor checks remain in the independent verifier. The block interval is not shortened to the cancellation block, and no cached success substitutes for RPC facts.

## Validation and fresh results

- TypeScript checking passed; all **63 tests** passed, including ten new regression cases.
- Regression coverage includes exact range coverage, concurrency, all SDK event index layouts, both fill roles, overlap conflicts, malformed/foreign/pending/duplicate logs, transient failures, persistent failures and invalid bounds.
- Fresh CLI verification passed for both recorded cycles: VERIFIED, CANCELLED, zero filled and remaining quantity, unchanged placement/cancellation hashes and scoped nonce checks.
- A fresh UI recovery of the crash cycle also passed at `2026-10-22T17:48:09Z` (the saved observation timestamp).
- [Fresh CLI report](../evidence/rpc-history-verification-2026-10-22-v2.json), [UI observation](../evidence/rpc-history-ui-recovery-2026-10-22-v2.json), [original failure diagnostic](../evidence/rpc-history-failure-diagnostic-2026-10-22.json), [test output](../evidence/rpc-history-tests-2026-10-22.tap) and [actual downloads](../media/demo-v2/README.md) are included as public review materials.

The new English demo v2 uses genuine application captures, including the successful fresh UI result. It is an edited narrated walkthrough, not continuous real-time recording. The original response-loss and restart scenario remains a previously recorded testnet experiment; this step only reads its results.

## Publication boundary

The user authorized publication of the source fix, documentation, demo v2 and fresh public evidence to GitHub. No X post, contest submission, new order, cancellation, signing or broadcast was performed. The original v3 archive remains unchanged; the repository includes this follow-up fix. OrderAnchor was subsequently [submitted to DoraHacks](https://dorahacks.io/build/50160) and is **Under Review**; see [the submission record](CONTEST-SUBMISSION-2026-10-22.md).
