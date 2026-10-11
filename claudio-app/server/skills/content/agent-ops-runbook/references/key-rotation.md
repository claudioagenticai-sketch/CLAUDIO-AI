# Key rotation

Read this for the monthly rotation and after any suspected exposure. Names, not values, go in the ops card.

| Secret | Where | Rotate | How |
|---|---|---|---|
| agent API key `ck_live_…` | `~/.claudio/credentials.json` | monthly; immediately if exposed | console → API keys → I have a public key → paste the **same** device public key (`claudio init` without `--force` prints it and changes nothing) → new key → `claudio login` (prompt) → `claudio whoami` → revoke the old key |
| device key | `~/.claudio/device.json` | if the machine or file is exposed | needs new keys: `claudio init --force` makes a new device key **and a new wallet** — plan the wallet first (see P3) |
| agent wallet | `~/.claudio/wallet.json` | only on exposure (can't be re-registered) | move funds out; new agent with a new setup |
| MCP key `cmk_…` | the app's config / secret store | at its expiry (30 / 90 / 365 days) or monthly | `/connect` → new key with the same scopes → update the app → revoke the old |
| OAuth grants (AI apps, `claudio login`) | the app / `~/.claudio/oauth.json` | when an app is no longer used | `/connect` → revoke the app · `claudio logout --oauth` |
| model / media keys | provider dashboards; `claudio keys` / `CLAUDIO_KEY_<NAME>` | quarterly; immediately if exposed | create new at the provider → `claudio keys set <name>` (prompts) → delete the old at the provider |
| social tokens | sealed in `~/.claudio/social/accounts.json` with the `social-vault` key | on expiry (LinkedIn 60 days, YouTube testing apps 7 days) or exposure | `claudio connect <network>`; revoke the app in the network's settings |
| `social-vault` key | key store / `CLAUDIO_KEY_SOCIAL_VAULT` | if exposed | new key, then reconnect every account (old sealed tokens become unreadable) |
| passphrase for `~/.claudio` | the owner's password manager | if exposed | re-run setup on a clean machine; there is no in-place change command |

Rules:

- An agent can have at most 3 active API keys (`409 key_limit`); revoke spares before rotating.
- Rotate by **adding the new key first**, switching, testing, then revoking the old — except on exposure, where you revoke first.
- `claudio keys set <name>` and `claudio login` without an argument both prompt without echo; prefer them over putting secrets on the command line.
- Keep a dated rotation log (what, when, who) without values.
