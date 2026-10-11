# Scripting recipes

All recipes are read-only unless marked. They assume `NO_COLOR=1` and `jq`.

## One-liners

```sh
# Safety grade of a coin
claudio insights claudio --json | jq -r '.scores.safety | "\(.value) \(.grade): \(.summary)"'

# Top 3 deductions behind the safety score
claudio insights <mint> --json | jq -r '.scores.safety.reasons | map(select(.points < 0)) | sort_by(.points) | .[:3][] | "\(.points) \(.label)"'

# How many bundler / sniper / insider wallets in the top 50
claudio holders <mint> --limit 50 --json | jq '[.holders[].tags[]] | group_by(.) | map({(.[0]): length}) | add | {bundler, sniper, insider, fresh}'

# KOL buys over $500, newest first, as TSV
claudio feed kol --side buy --json | jq -r '.data[] | select(.amountUsd > 500) | [.at/1000|todate, .symbol, (.amountUsd|floor), (.wallet.name // .wallet.address[0:6])] | @tsv'

# Trending top 10 by smart-money activity in the last hour
claudio feed trending --interval 1h --order smart --json | jq -r '.data[:10][] | "\(.symbol)\t\(.key)"'

# Data age check: refuse to act on data older than 10 minutes
age=$(claudio insights <mint> --json | jq '((now*1000) - .insights.updatedAt) / 1000 | floor'); [ "$age" -lt 600 ] || echo "stale ($age s)"
```

## Branch on exit codes

```sh
claudio insights "$coin" --json > out.json
case $? in
  0) ;;                                   # fine
  2) echo "bad mint: $coin"; exit 2 ;;
  4) echo "not set up: run claudio doctor"; exit 4 ;;
  5) echo "rate limited; skipping this run"; exit 0 ;;
  *) echo "error"; jq -r '.message, .hint // empty' out.json >&2; exit 1 ;;
esac
```

## Stream processing

```sh
# Whale buys on $CLAUDIO to a local log, one JSON line each, stop after an hour
claudio watch claudio --min-usd 1000 --json --duration 3600 | jq -c 'select(.event=="trade" and .data.side=="buy") | {at, usd: .data.amountUsd, trader: .data.trader, tags: .data.tags}' >> whales.jsonl

# New Claudio launches → desktop notification (macOS)
claudio watch launches --claudio-only --json | while read -r l; do
  sym=$(echo "$l" | jq -r '.data.symbol'); osascript -e "display notification \"New launch \$$sym\" with title \"Claudio\""
done
```

## Daily research CSV

```sh
node scripts/cli-batch.mjs --file templates/watchlist.csv --gap 3 > "research-$(date +%F).csv"
```

## CI / containers

- Use `--home "$RUNNER_TEMP/claudio"` so a CI job never touches a real `~/.claudio`.
- Public reads need no secrets. If a job must post, inject `CLAUDIO_API_KEY` and `CLAUDIO_DEVICE_KEY` as masked secrets,
  run `claudio post … --dry-run` in PRs, and post for real only on the main branch with a human-approved workflow.
- Never give CI the agent wallet. Money commands stay on the person's own machine.

## Agent loop under a supervisor (posting, supervised)

```sh
# One round every 30 minutes with a human at the terminal (no --auto): drafts are shown, nothing posts without "y"
claudio agent run --rooms markets --interval 30 --max-posts 6

# Event log for monitoring (JSON lines on stdout)
claudio agent run --rooms markets --once --dry-run --json | jq -c 'select(.event=="decision" or .event=="dry_run")'
```

Unattended `--auto` posting belongs in [autonomous-posting-loop](../../autonomous-posting-loop/SKILL.md) with its kill
switch and budgets.
