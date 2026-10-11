# Public RPC and WebSocket endpoints

_Live-tested 2026-09-27 from one host. Each endpoint was checked for chainId, median latency (5 calls), the largest `eth_getLogs` range it accepts (100 / 1k / 5k / 10k / 50k blocks, address + Transfer-topic filter), a 20-request burst, CORS, and for WS: `newHeads` + `logs` (Solana: `slotSubscribe` + `logsSubscribe`) for 60s._

The HTTP lists below are what `shared/chains.ts` uses (`publicRpc` then `rpcFallbacks`). Operators can put their own endpoints first with `<CHAIN>_RPC_URL` (comma-separated). `server/rpc.ts` is the single place that resolves them; the ingest pollers rotate on errors and switch immediately on a 429, and viem clients (server and browser) use a `fallback` transport.

## Robinhood Chain (4663)

Polled every 1.5s for 150s, the official RPC returned 4 × `429 Too Many Requests` out of 199 calls; the three endpoints now ahead of it returned none.

| Order | HTTP | ms | getLogs range | 150s poll |
|---|---|---|---|---|
| 1 | https://rpc-robinhood.globalstake.io | 88 | ≥50k | 199/199 |
| 2 | https://robinhood.api.pocket.network | 63 | ≥50k | 156/157 (1 timeout) |
| 3 | https://rpc.ordofi.network | 37 | 5k | 200/200 |
| 4 | https://rpc.mainnet.chain.robinhood.com (official) | 118 | ≥50k | 4 × 429 |

Not used:
- **robinhood.drpc.org:** getLogs is capped at 100 blocks; the poller asks for up to 2,000.
- **robinhood-rpc.publicnode.com:** getLogs needs an address filter and covers only about the last 100 blocks.
- **blockmachine:** 66 of 137 calls got 429.
- **tatum:** every call got 429.
- **blxrbdn:** getLogs returns 403.
- **routeme, nodeflare, arrowrpc:** returned 429, 403 and 530.

WS (all passed `newHeads` + `logs`):
- wss://rpc.ordofi.network
- wss://robinhood-rpc.publicnode.com
- wss://robinhood.drpc.org
- wss://rpc-robinhood.globalstake.io/ws
- wss://robinhood.api.pocket.network

The official RPC has no public JSON-RPC WS.

## BNB Chain (56)

HTTP order:
1. https://bsc-rpc.publicnode.com (5k; needs an address filter)
2. https://bsc.api.pocket.network (≥50k)
3. https://rpc-bsc.48.club (5k)
4. https://bsc.rpc.blxrbdn.com (5k)
5. https://1rpc.io/bnb (50-block cap, which equals the poller's range)

Not used for logs:
- **bsc-dataseed\*, defibit, ninicoin, binance.nodereal.io:** `eth_getLogs` returns "limit exceeded" even for a single block.
- **bsc.drpc.org and meowrpc:** 429 on bursts.

WS: publicnode, wss://rpc-bsc.48.club/ws/, pocket and wss://bsc.drpc.org.

## Solana

HTTP:
- https://api.mainnet-beta.solana.com
- https://solana-rpc.publicnode.com
- https://solana.api.pocket.network

All three passed `getSlot`, `getLatestBlockhash` and `getSignaturesForAddress(pump)` with no 429s. Solana documents a limit of 100 requests per 10s per IP (40 for a single method).

WS: api.mainnet-beta and publicnode passed `slotSubscribe` and `logsSubscribe`.

## Base (8453)

HTTP:
- https://mainnet.base.org (2k cap)
- https://base-rpc.publicnode.com (5k; needs an address filter)
- https://base.api.pocket.network (≥50k)
- https://base.rpc.blxrbdn.com (≥50k)

WS: publicnode, tenderly and pocket. drpc is rate-limited, and mainnet.base.org has no WS.

## Arc (5042, USDC gas)

HTTP:
- https://rpc.mainnet.arc.io (1k; 5k gets 429)
- https://rpc.blockdaemon.mainnet.arc.io (≥50k)
- https://rpc.quicknode.mainnet.arc.io (5k)
- https://arc-rpc.publicnode.com (5k)

WS: wss://rpc.blockdaemon.mainnet.arc.io/websocket, publicnode and drpc. The official and QuickNode sockets reject `logs` subscriptions (-32603).

## Why WS is opt-in

With `<CHAIN>_WS_URL` set, the EVM poller subscribes to `newHeads` and polls on every head, throttled to one poll per 150ms. On Robinhood (~0.1s blocks) that is about 6 HTTP calls a second instead of one every 1.5s, enough to hit free-tier limits again. Set a WS URL only together with a private `<CHAIN>_RPC_URL`.

## Testnets (contract deploys go here first)

| Testnet | chainId | RPC | Explorer | Faucet |
|---|---|---|---|---|
| Robinhood Chain Testnet | 46630 | https://robinhood-sepolia-rpc.publicnode.com, https://rpc.testnet.chain.robinhood.com | explorer.testnet.chain.robinhood.com | faucet.testnet.chain.robinhood.com (browser only), or bridge Sepolia ETH |
| BSC Testnet | 97 | https://bsc-testnet-rpc.publicnode.com | testnet.bscscan.com | bnbchain.org/en/testnet-faucet (0.3 BNB/24h; needs 0.002 BNB on mainnet) |
| Base Sepolia | 84532 | https://base-sepolia-rpc.publicnode.com, https://sepolia.base.org | sepolia.basescan.org | see docs.base.org faucets |
| Arc Testnet | 5042002 | https://rpc.testnet.arc.network | testnet.arcscan.app | faucet.circle.com (20 USDC/2h) |

PUSH0, TSTORE/TLOAD and MCOPY were confirmed to execute on every testnet above and on Robinhood and Arc mainnet. The contracts target Shanghai.

## Keyed providers (for production)

- **Robinhood:** its docs recommend Alchemy and also list Chainstack, QuickNode, Blockdaemon, dRPC, Validation Cloud and GlobalStake.
- **Alchemy free tier:** caps `eth_getLogs` at 10 blocks, so it needs about 2 calls per 1.5s poll on Robinhood.
- **dRPC free tier:** 100 req/s with a 100-block range.
- **Solana:** use Helius or QuickNode.
