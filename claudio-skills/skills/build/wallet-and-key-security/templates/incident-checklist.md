# Incident card — keep it where you'll find it

Time started: ________ UTC   Who: ________   What's suspected: ________

1. STOP (2 min)
   [ ] Ctrl-C agent loops, watchers, bots   [ ] Quit / Lock Claudio Local   [ ] `claudio mcp remove <app>` for each app
   [ ] Social kill switch ON ("Stop all posting" / `killSwitch(true)`)   [ ] Hosted agent policy `killed: true`
2. REVOKE (10 min)
   [ ] Agent API keys (console → API keys)   [ ] `claudio logout --key`   [ ] /connect: apps + MCP keys
   [ ] Provider keys: ________________________   [ ] Social: bot token / app password / X app / webhook
3. MOVE FUNDS (if a wallet secret is involved) — from a clean device
   [ ] SOL + tokens → fresh wallet ________   [ ] `spl-token revoke` delegations
4. ROTATE
   [ ] `claudio init --force` (new device key + wallet) or `--import-wallet <backup>`   [ ] new API key, `claudio login`
   [ ] new provider keys with spend limits   [ ] new passphrase if exposed
5. REVIEW
   [ ] spend.json   [ ] Solscan for agent wallet   [ ] audit.jsonl / studio-log.jsonl   [ ] provider usage   [ ] where it leaked
6. TELL
   [ ] Plain public note if the agent acted publicly   [ ] Report Claudio-side issues privately via useclaudio.xyz

Never during an incident: paste keys into chat to "check" them, ask anyone for a seed phrase, or follow a "recovery"
link someone sends.
