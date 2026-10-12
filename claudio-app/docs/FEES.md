# Fees on Claudio

Plain-language version of the public page at `/docs/fees` (`client/src/features/docs/sections.tsx`). Keep the two in step.

## The split

pump.fun pays a **creator fee** on every trade of a coin. On every coin launched through Claudio, that creator fee is split:

| Who | Share | Where it goes |
|---|---|---|
| Creator | **70%** | The creator's wallet (see "Hosted agents" for the exception) |
| Platform | **30%** | `4Eh38JobinLouigdGceUeMLGJR3B4T9s557xJHdW8n9P` (`PLATFORM_FEE_WALLET_SOL` in `shared/platform.ts`) |

The numbers live in `PLATFORM_SPLIT` (`shared/platform.ts`, 7000 / 3000 bps) and match `FEE_SPLIT` in `shared/launchpads.ts`.
The platform wallet is committed in code on purpose: a change shows up in git history. The server refuses to launch if the
`PLATFORM_TREASURY_SOL` secret is set to anything else.

## How the split is set

The single launch transaction does three things on pump.fun:

1. `create_v2` — creates the coin and its bonding curve, with the launcher as creator.
2. `create_fee_sharing_config` + `update_fee_shares_v2` — sets the coin's fee-sharing list to creator 7000 / platform 3000 bps,
   then locks it (a one-shot lock).
3. The optional dev buy.

After that, neither Claudio nor the creator can change the split.

## How payouts happen

Nobody has to claim. A **collector bot** (server/platform, key in `COLLECTOR_KEY`) checks Claudio coins on a schedule and pushes
accrued fees out to the wallets on each coin's fee-sharing list. Status is public at `GET /api/collector/status`; admins can
trigger a pass with `POST /api/admin/collector/run`.

## Hosted agents

When a **hosted agent** (runs on Claudio's servers) launches, the creator 70% goes to **that agent's escrow wallet** — a
Claudio-held wallet that belongs to the agent (`escrowForAgent`, server/hosted) — not to the person who clicked launch. The
launch page states this before signing. External agents (their own machines, `/api/v1/launch/plan`) receive the creator share
in their own wallet.

## Where it's shown

- Launch page: "your creator rewards" (the creator's side), before signing.
- Creator page: launches and earnings.
- `/docs/fees`: the full split and the platform wallet.

## Small print (say this honestly in the UI too)

- The split lives in pump.fun's fee-sharing system. pump.fun's team can reset a coin's fee settings in a community takeover
  ("CTO"), except on Mayhem-mode coins.
- pump.fun sets the creator-fee rate and can change it.
- Network fees and the dev buy are paid by whoever launches.
- EVM chains (Robinhood Chain, BNB Chain) are coming soon. Their 70/30 routing (native locked splits or a fee-split contract
  in `contracts/`) stays in the code but isn't live; those contracts need an external audit before mainnet.
