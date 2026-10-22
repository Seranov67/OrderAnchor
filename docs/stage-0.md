# OrderAnchor — stage 0, 20 October 2026

Current status update (22 October 2026): OrderAnchor was submitted and is **Under Review**. See [the submission record](CONTEST-SUBMISSION-2026-10-22.md). The dated access observations below describe the earlier stage.

Historical checkpoint: public network reads were complete; creation/funding/permission checks for a separate test wallet were still pending. These are the facts at this date, not the current state. Later cycle reports record funded execution.

## Measurements

| Check | Observed result |
|---|---|
| HTTP RPC chain ID | 0xc4cf = 50383, HTTP 200 in the first run outside the sandbox |
| WebSocket RPC | eth_chainId = 0xc4cf in both outside-sandbox runs |
| Latest block | 28600978, hash 0x9a35ad2e94f4e53d20cec779ec6763976d7a3fb233139cacbca45d7d4bd786e2 |
| Block time | 2026-10-20 15:59:54 UTC, roughly two seconds from the local clock, within clock uncertainty |
| Gas price | 6,000,000,000 wei = 6 gwei in two responses; a snapshot, not a transaction estimate |
| GraphQL | HTTP 200 and data.__typename=query_root in two runs |
| HTTP stability | One block request timed out; a repeated block read succeeded, but chain ID had a connect timeout in that run |
| Contracts/SDK/market | Not yet checked because HTTP results were incomplete |
| Wallet/STT/margin/permissions | Unknown: the separate test wallet did not exist yet |

The network JSON files dated 15:58:29.130Z and 15:59:45.303Z preserve responses. The earlier 15:58:19.402Z file records sandbox EACCES, not a dreamDEX outage. GraphQL root success does not prove order-history functionality; WS chain ID does not prove subscription recovery.

## Submission access

The [DoraHacks event page](https://dorahacks.io/hackathon/dreamdex-perps-bounty/detail) displayed Unregister, confirming registration. Submit Build opened an Organizer Disclaimer with I Agree & Continue. The agent did not accept it or open the build form, so whitelist access remained unconfirmed. The stated support path was a Discord ticket or SomniaHacks Telegram with the registration email. No message was sent.

The read disclaimer described bounty rewards in USDso on Somnia mainnet and an expected base payout by 15 November, with a separate mainnet MVP condition. This historical reward information was not a test-account funding requirement and must be rechecked before submission.

## Network configuration

Source: [Perps developer documentation](https://app.testnet.dreamdex.io/docs/developers/perps-testnet).

| Field | Value |
|---|---|
| Region | Hideki/DreamDEX; the bounty refers to Tokyo |
| Chain ID | 50383 / 0xc4cf |
| RPC | https://api.hideki2.infra.testnet.somnia.network |
| WebSocket | wss://api.hideki2.infra.testnet.somnia.network/ws |
| Indexer | https://hideki-dev.smk.somnia.host/v1/graphql |
| Gas | STT |
| Margin | Paper USDso in the Perps account |
| Explorer | https://explorer.testnet.somnia.network/tokyo |

Shannon 50312 and Somnia mainnet 5031 are different networks. Funding Shannon does not establish Hideki STT availability.

## Setup procedure at this checkpoint

1. Open [dreamDEX testnet](https://app.testnet.dreamdex.io) and Connect. MetaMask and email/social login were available. Reuse an existing login method: a different method can create a separate account.
2. MetaMask can be the login wallet without being the Perps margin owner. A separate MetaMask account under the same recovery phrase is not an independent seed backup; see [official instructions](https://support.metamask.io/configure/accounts/how-to-add-accounts-in-your-wallet/).
3. In a Somnia Account, select New wallet and name it OrderAnchor Test. Legacy Account does not support Link a Bot.
4. Use the official Perps Arena funding path as allowed by the bounty. The page described 1000 paper USDso and 20 STT weekly per trading wallet; actual credit was not yet checked. One person, one Arena account.
5. Verify usable Perps margin, not just Spot balance. The app offered Perps/Spot movement where applicable.
6. Copy the public trading-owner address for read-only checks. No private material is needed.

Login wallet, trading owner, DoraHacks reward wallet and bot signer are distinct roles. [Link a Bot](https://app.testnet.dreamdex.io/docs/trading/common/link-a-bot) uses a separate bot key, its public address, Perps-only permission and STT via Send it … for gas or Top up. This checkpoint generated no key or permission grant.

The 10 SOMI mainnet condition concerned Arena prizes, not an established builder-bounty requirement. Buying SOMI was not needed for this setup step. Additional organizer-provided bounty USDso requires a separate non-Arena account and must not be transferred into Arena. SDK self-claim was documented but not validated here, so it was not assumed to fund the account.

Stage 0 required verified owner/signer addresses, STT, usable margin, permissions, current market and pre-send checks. All live trading remained blocked until those checks were completed.
