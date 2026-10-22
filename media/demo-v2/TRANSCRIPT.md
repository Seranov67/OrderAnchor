# OrderAnchor demo v2 — English transcript

## 00:00 — ORDERANCHOR / TESTNET DEMO

OrderAnchor helps dream DEX Perps developers recover uncertain transactions by the original hash, inspect the order outcome, and export verifiable evidence.

## 00:10 — 01 / INSPECT OPERATIONS

The interface shows two completed testnet cycles: normal placement and cancellation, and recovery after locally injected response loss and process termination.

## 00:20 — 02 / FOLLOW THE JOURNAL

The crash journal records the signed transaction before sending, then an unknown outcome. After restart, the original hash was recovered without another placement. Cancellation completed the recorded cycle.

## 00:33 — 03 / RECOVER VIA RPC

Now we click Recover via R P C. This reads transactions, canonical receipts, order state, and historical nonces. It sends no new transaction.

## 00:44 — 04 / CHECK THE RESULT

The fresh result confirms cancellation with zero filled and remaining quantity. The placement hash is unchanged. No additional mined signer transaction was found within this cycle's block interval.

## 00:57 — 05 / EXPORT JSON

Export J S O N downloads portable public evidence for one operation. Export both cycles includes both demonstrations. Neither export includes private keys or broadcastable signed transaction bytes.

## 01:10 — 06 / PUBLIC EVIDENCE

The downloaded bundle can be checked independently without the private database. Its checksum detects changes. The verifier checks transaction identity, receipts, order events, and scoped nonce history.

## 01:23 — ORDERANCHOR / BUILT FOR BOT DEVELOPERS

OrderAnchor is available on GitHub. This edited walkthrough uses real app captures and read only recovery. The original fault was injected locally. No new orders or cancellations were sent while making this demo.
