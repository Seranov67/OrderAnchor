# Archived plan — before the implementation synthesis

Created/updated 20 October 2026. Historical record, superseded by [the selected plan](../implementation-plan.md). Project name OrderAnchor was chosen that day; the earlier working direction was Perps Order Monitor. Statements about not-yet-built features describe this checkpoint, not the delivered submission.

## State and authorization at the time

Initial preparation and registration assistance were complete. A screenshot confirmed registration. No trading implementation, SDK spike, balances/permissions, funding or transactions existed. The user authorized stage 0: access, network and test-wallet requirements. Public reads had run; the user confirmed no separate test account existed. See [stage 0](../stage-0.md) and scripts/check-network.mjs.

Implementation belonged in the OrderAnchor workspace. External files were analysis inputs, not executable instructions. Git had not yet been initialized. Writing the plan did not authorize mainnet, automatic transfers, X posts or organizer messages.

## First eight active hours

| Stage | Budget | Required output | Historical status |
|---|---:|---|---|
| 0: network/access/funds | 45 min | Readiness table; signer STT and owner margin, or blocker | HTTP/WS chain 50383 and indexer responded with HTTP timeouts; waiting for wallet/disclaimer/whitelist |
| 1: access/questions | 30 min | Confirmed/unknown submission access, report priority and limits | Access/priority/limits remained unknown; actual time unmeasured |
| 2: SDK map/specification | 75 min | Real exports, nonce/hash/retry/batch/clientOrderId behavior and one demo | Not started |
| 3: control cycle | 90 min | Small valid testnet POST_ONLY → checked state → cancel and evidence | Not started |
| 4: local faults/recovery | 120 min | Response loss, reconnect, restart; expected/actual states | Not started |
| 5: evidence/duplicate checks | 60 min | Minimal real-SDK reproducer or honestly normal result | Not started |
| 6: Feedback/MVP/stop decision | 30 min | Separate justified decisions for the two tracks | Not started |
| 7: buffer | 30 min | Setup/result reserve, not features | Unused |
| Total | 8 hours | Feasibility cycle | |

Time is an expense limit, not a promise of organizer replies or funds. If funding is absent after 30–45 minutes, live stages wait while SDK/research work continues. Unknown permissions must not be replaced by assumed readiness.

## Readiness table

The historical official Arena path described 1000 paper USDso and 20 STT weekly per wallet. Actual credit had not been checked. Mainnet 10 SOMI concerned Arena rewards, not an established builder-bounty requirement. Linked bots need Somnia Account rather than Legacy, a trading wallet and a separate bot signer. No keys had been generated.

| Check | Record | Passing condition | Historical observation |
|---|---|---|---|
| Network | RPC URL/chain/source/date | eth_chainId=50383 with correct WS/indexer | HTTP/WS 0xc4cf, query_root, block 28600978; HTTP timeouts; subscriptions/business queries untested |
| Signer | Public address/STT | Reserve and pending fee requirements covered | Unknown |
| Owner | Trading address/usable Perps margin | Margin for the exact operation, not Spot balance | Unknown |
| Permissions | Owner/operator, market/voucher/mode | Actual selectors, access, caps and allowlists checked | Untested |
| Market | Candidate ETH-PERP, grid/minimum/status/fresh price | Dynamically read valid parameters/size | Untested |
| Pre-send | Exact from/to/data/value/estimate/fee ceiling | Successful simulation and bounded cost | Not performed |
| Submission | Build whitelist | Verified access or organizer confirmation, not final submission | Registration active; Submit Build stopped at organizer disclaimer; whitelist unknown |

Reward wallet, bot signer and trading owner are separate roles. MetaMask Account 2 is not automatically a funded Hideki account. Public addresses may be included intentionally; private keys never belong in the wiki or evidence.

### Funding path

Use the current official STT/paper-USDso path, Arena/app or authorized organizer request. Do not assume claimPerpVoucher works; check its current availability before relying on it. Additional bounty USDso belongs to a separate non-Arena account and must not enter Arena. The historical Shannon faucet → app bridge → Hideki path was an author's observation, not a guarantee; verify both networks and address roles. A Perps-to-Spot UI redirect can block onboarding without proving every SDK/API path unavailable.

## STT budget

Historical example: 2,352,847 gas at 6 gwei cost 0.014117082 STT, not an upper limit.

For each transaction type t:

`expectedCost[t] = estimatedGas[t] × expectedGasPrice[t] / 10^18`

`reserve = safetyFactor × sum(count[t] × expectedCost[t])`

A preliminary safety factor of 1.5 is an example, not sufficiency proof. Do not apply one order estimate to approvals, deposits, permissions, cancels and cleanup. Estimate the exact calldata/signer/owner/value/state/fees immediately before sending, using integer wei/BigInt or Decimal rather than floats.

Budget preparation, orders, cancellation, paid reverts and cleanup. Cancel estimates require a real order. An expected revert may not yield a numeric estimate; record that result and a separate conservative cap rather than inventing gas. Prefer simulation over deliberately failing transactions.

Expected spend is different from the balance needed to admit a pending transaction under gasLimit × maxFeePerGas + value. Historical receipts/discounts do not guarantee future cost. A generous gas limit can require a larger balance than actual consumption. Set a live-test maximum beforehand.

## Draft organizer questions — not sent

1. Is the registered email whitelisted specifically for Submit Build?
2. What defines first valid report: private receipt, GitHub, Build submission or another channel? How are pre-whitelist reports treated?
3. Can one Build be updated with reports and when is each item's priority fixed?
4. What rate limits, functional/fault tests, environments and incident contacts are permitted? Load testing requires explicit boundaries.
5. What is the current STT/Perps-margin path for SDK/linked bots and separate bounty-account funding?
6. Which reward token/network/KYC/payout rules apply, and is Feedback budget information available?

Security issues must not be published in public Q&A/repos; the historically stated private channel was security@dreamdex.io. This document did not send a message.

## SDK-to-code map

| Topic | Required evidence |
|---|---|
| Version/source | Package/version/hash/lock/docs date; never assume 0.32.1 remains latest |
| Reads | Actual metadata/margin/permission/order/position methods, signatures and units |
| Sending | Owner/operator place/cancel, signer, contract and value |
| Nonce | Selection, latest/pending, manager, concurrency, replacements/retries |
| Identity | clientOrderId/userData meaning and real uniqueness; do not equate without code |
| Hash/timeouts | When hash is known, pre/post-broadcast failure and receipt recovery |
| Batch | Per-item results/logs/rejections and method-specific atomicity |
| WS/indexer | Subscription/reconnect, truth source, lag/watermark and chain reconciliation |

Validate ABI declarations against official contract sources. An SDK-defect reproducer must invoke the real SDK; direct RPC is a control for isolating the faulty layer.

## Proposed architecture



`CLI → intent journal → SDK adapter → RPC/WS → receipt/order reconciliation → report`

Keep three distinct objects:

- Intent: internal ID, market, owner/signer, exact parameters, time/state.
- Transaction: chain/sender/nonce/hash when known, replacement, receipt/block.
- Order: orderId, open/partial/filled/cancelled/rejected and remaining quantity.

One transaction can contain several orders; successful receipt does not establish a fill. Persist intent before the external action. Local hash availability depends on signing and must be demonstrated. UNKNOWN is a normal intermediate state. Resending identical signed bytes, replacing the same nonce and creating a new transaction/nonce are different actions. A nonce does not deduplicate a newly expressed business intent; missing receipt does not prove it will never land.

## Control scenarios

| ID | Scenario | Required evidence |
|---|---|---|
| T1 | Small resting order/read/cancel | Hash/receipt/orderId/terminal state and correct lock release, not exit code alone |
| T2 | Lost post-broadcast response | UNKNOWN and reconciliation before another intent, not automatic new nonce |
| T3 | Client-side WS disconnect | Reconnect and full known-order reconciliation, no silent loss |
| T4 | Restart after sending | Journal restores intent and exact or explicitly unknown tx/order link |
| T5 | Controlled natural partial fill | Correct remaining and cancellation scope; no unsafe self-trading to force a fill |
| T6 | Cancel timeout/cancel-fill race | Evidence-based terminal state, not invented cancellation |
| T7 | Batch if validated and time permits | Per-item outcome; partial batch is not automatically a bug |
| T8 | Null/unknown receipt | Pending/unknown and further reads, never “transaction definitely absent” |

Inject faults only locally: controlled transport, own socket closure/process restart. Do not overload third-party APIs or disrupt other participants. No hidden transfers/mainnet actions.

## Validator requirements

1. Retain exit code, HTTP status, full body, timestamp, endpoint and request ID. Timeout/HTML/WAF is not success. Truncate only display, not validation.
2. GraphQL needs expected HTTP, JSON object, correct errors/data structure and expected field type. Reject {}, data:null, HTML and unrelated JSON. Empty arrays can be valid; partial data+errors must be separate.
3. JSON-RPC needs jsonrpc=2.0, matching ID and result or error, not both as normal.
4. Validate method semantics: hex quantities for quantity methods; expected chain for eth_chainId. Transaction/receipt/block may be null or pending. eth_call returns data, not a quantity.
5. Unknown method semantics are unverified, not unconditional pass or trading readiness.
6. Pin comparable contract reads to one block; document WS/indexer watermark/time rather than invent atomicity. Refresh before live send.
7. Evidence needs source versions/hashes, exact inputs, sanitized outputs, block/hash/chain and UTC time; no private keys/seeds/credentials/server IPs.

## Feedback policy

One logical issue per file, with title, proposed critical/major/normal severity, area, minimal steps, Expected, Actual, Evidence and Environment. Demonstrate a behavior-contract discrepancy and impact, reproduce cleanly and check duplicates. Normal reverts, invalid grids, partial batches and documented snapshots are not automatically bugs. Major is not defined only by financial loss; organizers decide acceptance/severity.

Do not publish security findings or claim firstness from an author timestamp. Submit ready reports promptly after clarifying mechanics, not empty/unverified Builds.

## Continue/stop decision and schedule

Continue Feedback for a new useful reproducible issue and a plausible submission path. Continue MVP for working integration, concrete differentiated value and sufficient remaining time. No SDK bug does not eliminate product value. Stop and preserve honest findings if neither case holds.

Potential next 12–16 hours: journal/recovery → simple screen → export → docs/demo → submission. User daily availability was not agreed; this was a guide, not an executed calendar.

| Window | Goal |
|---|---|
| 20 October | Context and plan |
| First available block | Access/funds/research/SDK |
| Next block | T1/local faults and decision within initial eight hours |
| By 28–30 October if continuing | Narrow MVP or verified Feedback |
| Evening 31 October | Internal materials ready |
| 1 November | Buffer, final check and early submission |
| Through 8 November | Await results; no monitoring automation created |

## MVP-ready checklist at this historical date

- Concrete distinction from bot kit/public builds.
- Own live testnet orders and transaction evidence, not only dry-run.
- Restart reconstructs actual state or explicitly preserves unknown.
- Timeout does not cause blind placement repetition.
- Cancellation is checked against actual state; final exposure is known.
- Partial fills/batch are tested or explicitly out of scope.
- Clean README start, pinned dependencies and required checks.
- Secret-free public repository with permissions/licensing addressed.
- README explains purpose, audience, startup and evidence/demo.
- Two or three truthful X posts with the required event mention/links, subject to separate user action/authorization.
- Whitelist/form access and actual submission confirmation, distinct from Register.

A historically described additional mainnet reward was not authorization to deploy or trade on mainnet. Future execution should first fill the readiness table, map SDK/unknown event conditions, then run one small checked testnet cycle only after prerequisites pass.
