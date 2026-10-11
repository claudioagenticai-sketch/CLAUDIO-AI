# Worked session: Claudio Data in Claude Code, Trade added later

Person: "Add Claudio to Claude Code so I can ask about Solana coins. I don't want it trading."

## 1. Check what's live

Expected output once the online servers are live (on 2026-10-08 production still showed "not live on this server yet"):

```sh
$ npx @useclaudio/cli doctor
  ── Claudio ──────────────────────────────────────────────
  ✓ Site                  https://useclaudio.xyz · HTTP 200 · 201 ms
  ✓ Clock                 in sync with the server (signed requests allow ±5 min)
  ✓ Insights              GMGN data on · cache hit rate 60% · queue 0
  ✓ MCP data              https://useclaudio.xyz/mcp/data · answers MCP
  ✓ MCP trade             https://useclaudio.xyz/mcp/trade · reachable (sign-in required)
  …
```

(If this row says `! MCP data … not live on this server yet`, switch to [local-fallback.md](local-fallback.md).)

## 2. Preview, then install

```sh
$ claudio mcp install claude-code --dry-run
  claudio › Install in Claude Code · claudio · https://useclaudio.xyz/mcp/data
  ~/.claude.json
  + "claudio": { "type": "http", "url": "https://useclaudio.xyz/mcp/data" }
  Dry run — nothing was written.

$ claudio mcp install claude-code
  ✓ Installed claudio in Claude Code (backup: ~/.claude.json.claudio-backup)
  · The app opens https://useclaudio.xyz/connect the first time to sign in with your wallet.
```

Equivalent by hand: `claude mcp add --transport http --scope user claudio https://useclaudio.xyz/mcp/data`.

## 3. Verify in a session

```text
> /mcp
  claudio · connected · 15 tools

> Use Claudio to score $CLAUDIO and tell me how old the data is.
  ⏺ claudio - get_coin_scores (MCP) { "coin": "claudio" }
  Safety 80.6/100 (good) — no clear problem; biggest issue: the creator wallet has launched ~171K tokens.
  Holders 90/100 (good) — top 10 hold ~20.5% of the float.
  Chart 17/100 (risky) — "slow bleed": about −43% over 20 bars.
  Data is seconds old (from GMGN via Claudio's cache). This is research, not financial advice.
```

Expected shape: one `get_coin_scores` call, three scores each with a grade and reasons, and an age line.

## 4. Later: "OK, let it quote trades, but I sign"

```sh
$ claude mcp add --transport http --scope user claudio-trade https://useclaudio.xyz/mcp/trade
```

```text
> /mcp → claudio-trade → Authenticate
  (browser opens https://useclaudio.xyz/connect → sign the message with the wallet → tick read + trade:quote only)

> Quote a 0.01 SOL buy of $CLAUDIO. Don't prepare it.
  ⏺ claudio-trade - quote (MCP) { "coin": "claudio", "side": "buy", "amount": 0.01 }
  Expected ≈ 30,9xx tokens, minimum ≈ 26,3xx at 15% max slippage, price impact < 0.1%, fees ≈ 0.0001 SOL, route pump.fun / PumpSwap.
  Nothing was prepared or sent.
```

Because only `trade:quote` was granted, a later `prepare_trade` call fails with `insufficient_scope` until the person
reconnects with `trade:prepare`. That is the intended guard rail.

## 5. Undo

```sh
claude mcp remove claudio-trade      # and revoke the app on https://useclaudio.xyz/connect
```
