# OrderAnchor Test — wallet setup checkpoint

22 October 2026. Historical setup record; later linked/funded status and live transactions are documented in the cycle reports.

## Public identities

- Trading owner, OrderAnchor Test: `0xCf0a0858C6F6e81e553E580af6617aa128E96533`.
- Active bot signer: `0xa50a0cC153807a86e55A613f327Be6752CdeB389`.
- Testnet chain ID: 50383.

The wallet overview initially displayed 20 STT and a 1000 USDso Voucher. Voucher display alone did not prove usable MarginBank collateral; RPC subsequently confirmed the margin before the live cycle.

## Local key handling

The signer was generated under its owner's Windows profile and encrypted using DPAPI CurrentUser. An actual persisted-file round trip independently derived the same public address. ACL access was limited to that user and SYSTEM. No plaintext key was printed, placed in command arguments/environment, or saved in a plaintext file.

DPAPI requires the original Windows profile; the encrypted file alone is not a portable backup. All key files, wallet metadata and private SQLite files are excluded from the submission.

An earlier unfunded sandbox-only fixture key was never linked or used. The active signer was regenerated under the user's profile so it was usable outside the sandbox. That inactive fixture is also excluded.

## Linking

Only the active public bot address was linked to OrderAnchor Test with Perps access, not Spot. The bot received 5 STT for gas. Private owner keys were not required. Before trading, RPC checked owner margin, bot balance and place/cancel permissions. Wallet creation itself did not automatically submit trades.
