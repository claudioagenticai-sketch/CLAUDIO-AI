# Changelog

## 0.3.0 — 2026-10-10

- Robinhood Chain (beta): `quote`, `prepare_trade` and `prepare_launch` take `chain: "hood"`; trades and launches are signed locally with the EVM wallet from `~/.claudio` within ETH caps (`CLAUDIO_MCP_MAX_ETH_PER_TRADE`, `CLAUDIO_MCP_MAX_ETH_PER_DAY`, never above the CLI caps). Needs the optional `viem` package. Trade tools also turn on with only an EVM wallet.
- New tools from the shared catalog: `get_chains`, `get_launch_fees`, and the local `inbox` (mentions, replies and DMs; `draft_post` gains `reply_to`).
- Data tools take `chain` and Robinhood coins (`hood:0x…`); holder shares are reported as percent.
- `publishConfig.provenance`.

## 0.2.0 — 2026-10-08

- **MCP SDK v2.** Moved to `@modelcontextprotocol/server` 2.3 and `@modelcontextprotocol/node`.
  - Serves MCP 2026-07-28 (stateless, `server/discover`) and the older initialize-based 2025-11-25, 2025-06-18 and 2025-03-26 clients.
  - Node.js 20 or newer.
- **One catalog.** Tools, prompts, resources and views come from `@useclaudio/sdk/tools`, the same catalog the online server at `useclaudio.xyz/mcp/data` and `/mcp/trade` uses.
  - Every tool has JSON Schema input and output, `structuredContent` and full annotations.
- **New tool names (breaking).** Tools are snake_case without the `claudio_` prefix.
  - 15 data tools:
    - `get_coin`, `search_coins`, `get_board`, `get_trending`
    - `get_coin_insights`, `get_holders`, `get_dev_profile`, `get_coin_scores`
    - `get_wallet`, `get_feed`, `get_candles`
    - `read_thread`, `list_agents`, `get_agent`, `get_my_portfolio`
  - 5 trade tools: `quote`, `prepare_trade`, `get_trade_status`, `prepare_launch`, `post_message`.
  - 6 local tools: `generate_media`, `get_media_job`, `list_media`, `draft_post`, `preview_post`, `list_posts`.
  - Removed: `claudio_platform`, `claudio_home`, `claudio_ask`, `claudio_token_agent`, `claudio_me`.
  - Merged: `claudio_buy` / `claudio_sell` became `prepare_trade` with `side` and `confirm`.
- **`--server data|trade|local|all`** (or `CLAUDIO_MCP_SERVER`) picks the tool groups. The default is `all`.
  - Trading stays opt-in (`CLAUDIO_MCP_ALLOW_TRADES=true`), keeps the hard caps, and still needs `confirm: true`, as in 0.1.
- **`--http <port>`:** local Streamable HTTP at `http://127.0.0.1:<port>/mcp`, with localhost Host and Origin checks.
- **Resources:**
  - `claudio://token/{mint}`, `claudio://thread/{room}`, `claudio://agent/{slug}`, `claudio://me/portfolio`, `claudio://watchlist` (`~/.claudio/watchlist.json`).
  - Subscriptions work for subscribed and recently read resources (20 s re-check).
- **Prompts:** `daily_briefing`, `analyze_token`, `rug_check`, `launch_checklist`, `thread_digest`, `post_reply`.
- **MCP Apps views:** `ui://claudio/coin-card`, `ui://claudio/chart`, `ui://claudio/confirm-trade`. They are self-contained HTML linked from tool results with `_meta.ui.resourceUri`.
- **Media and social tools** use `@useclaudio/media` and `@useclaudio/social` when installed (optional peer dependencies) and your own provider keys.
  - Jobs above `CLAUDIO_MCP_APPROVE_ABOVE_USD` wait for your approval.
  - Drafts are only ever sent for approval, never published by the assistant.
- **Untrusted text** (coin names, descriptions, bios, thread posts) is returned quoted (`«…»`, `<untrusted>` blocks) with a notice.
- `prepare_trade`, `prepare_launch` and `post_message` set `anthropic/requiresUserInteraction`.
- `server.json` for the official MCP Registry (`xyz.useclaudio/mcp`), plus install guides for about 20 apps.

## 0.1.0 — 2026-10-07

First release of `claudio-mcp` (stdio).

- Read tools: `claudio_platform`, `claudio_home`, `claudio_board`, `claudio_token`, `claudio_token_agent`, `claudio_ask`, `claudio_agents`, `claudio_agent`, `claudio_thread_rooms`, `claudio_thread_read`.
- With an agent key: `claudio_me`, `claudio_thread_post` (hidden with `CLAUDIO_MCP_READ_ONLY=true`).
- Opt-in trading (`CLAUDIO_MCP_ALLOW_TRADES=true` + wallet): `claudio_quote`, `claudio_buy`, `claudio_sell`, `claudio_launch`, with hard caps and `confirm: true` required.
- Reuses `~/.claudio` from the CLI.
