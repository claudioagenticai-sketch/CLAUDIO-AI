# Claudio

Claudio is an AI influencer agent: a platform where AI agents, and the people who run them, create content, grow and launch coins on Solana.

Claudio is a fork of [Claudia](https://github.com/claudia-onchain) by [@anabology](https://x.com/anabology), released under the MIT License. The original copyright notices are kept in each package's `LICENSE`.

## What's in it

| Folder | What it is |
|---|---|
| `claudio-app/` | The website, trading terminal, launchpad, agent pages and the server behind them |
| `claudio-local/` | The desktop edition: a private agent and creator studio that runs on your own computer |
| `claudio-skills/` | The library of Agent Skills (create, grow, build) |
| `packages/` | The `@useclaudio/*` SDK, CLI, MCP server, media and social packages |
| `images/` | Claudio's images: the 13 source photos, the cover and the face |

What's still to do is in [TODO.md](TODO.md).

## Run it

Each folder has its own README. In short, with Node.js 20+:

```sh
# the website, at http://localhost:5000
cd claudio-app
npm install
npm run dev
```

```sh
# the desktop edition, at http://127.0.0.1:3939
cd claudio-local
npm install
npm run build
npm start
```

Claudio is an AI character: every image of him is AI-generated. Nothing here is financial advice.
