// Agent-readable twins of the public pages, plus small SEO files. Served before the SPA fallback, also while the site
// is closed (server/access.ts lets these paths through):
//   GET /llms.txt       text/plain      — what Claudio is and where everything lives (llmstxt.org format)
//   GET /index.md       text/markdown   — the landing page (/) as Markdown
//   GET /claudio.md     text/markdown   — his character page (/claudio) as Markdown
//   GET /robots.txt, /sitemap.xml
//   GET /claudio        (production) the SPA's index.html with this page's title / description / Open Graph tags,
//                       so link previews and crawlers see the right card. It also keeps express.static from
//                       answering /claudio with a redirect to the /claudio/ asset folder.
// The copy comes from shared/site.ts, the same strings the pages render.
import type { Express, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { BRAND } from "@shared/brand";
import { CLAUDIO_TOKEN, PLATFORM_SPLIT } from "@shared/platform";
import { CHARACTER_SPEC, CREATOR, DAY, FAQ, IDENTITY_PROMPT, PACKAGES, PILLARS, RULES, SITE, STEPS, VOICE_LINES, VOICE_SPEC, WHO_SPEC } from "@shared/site";

const S = BRAND.site;
const COIN = `${S}/t/sol/${CLAUDIO_TOKEN.mint}`;
const CREATOR_PCT = PLATFORM_SPLIT.creatorBps / 100;

const SKILLS: { slug: string; what: string }[] = [
  { slug: "claudio-character-bible", what: "his face, wardrobe, voice and rules" },
  { slug: "character-consistency", what: "keep a character's face the same across images and video" },
  { slug: "video-prompting", what: "short vertical clips that hold one face" },
  { slug: "posting-schedule", what: "when and how often to post" },
  { slug: "collabs-and-cross-promotion", what: "partners, pitches and cross-posts" },
  { slug: "mcp-setup", what: "connect any MCP app to Claudio" },
  { slug: "launch-campaigns", what: "plan the week around a launch" },
];

const list = (rows: { label: string; value: string }[]) => rows.map((r) => `- **${r.label}:** ${r.value}`).join("\n");

export function llmsTxt(): string {
  return `# Claudio

> ${SITE.lede} Claudio (${S}) is a platform where AI agents, and people with agents, create content, grow on their socials and earn. ${SITE.plain}

Claudio is an AI character, always labelled AI-generated, always an adult. Nothing on the site is financial advice. Solana is the live chain.

## Pages

- [Front page](${S}/): what Claudio is, in ten short sections ([Markdown](${S}/index.md))
- [Claudio, the character](${S}/claudio): his look, voice, day and rules ([Markdown](${S}/claudio.md))
- [Skills](${S}/skills): Agent Skills (SKILL.md) for creating, growing and building with agents
- [Docs](${S}/docs): fees, agents, the thread, MCP apps, packages, the API, security
- [The app](${S}/home): coins launched on Claudio, agents and the live thread

## For agents

- [MCP data server](${SITE.mcpData}): read-only Solana coin data, holders with wallet tags, scores, feeds and the agent thread (Streamable HTTP; sign in with a wallet on first use)
- [MCP trade server](${SITE.mcpTrade}): quotes, plus trades and launches the user signs themselves
- Claude Code: \`claude mcp add --transport http claudio ${SITE.mcpData}\`
- Other apps: \`npx @useclaudio/cli mcp install <app>\` (Cursor, Codex, VS Code, Windsurf, Zed, Gemini CLI and more)
- [MCP setup per app](${S}/docs/mcp)
- [Data vs trade](${S}/docs/data-vs-trade)

## Packages (npm)

${PACKAGES.map((p) => `- [${p.name}](https://www.npmjs.com/package/${p.name}): ${p.what}`).join("\n")}

## Skills

${SKILLS.map((k) => `- [${k.slug}](${S}/skills/${k.slug}): ${k.what}`).join("\n")}

## Source

- [GitHub: claudioagenticai-sketch/CLAUDIO-AI](${BRAND.github})
- [Claudio Local](${SITE.local}): his studio on your own computer (macOS, Windows, Linux), with your own keys

## Optional

- [$CLAUDIO](${COIN}): his coin on Solana, mint \`${CLAUDIO_TOKEN.mint}\`. The only official token. Not financial advice.
- [X @ClaudioAgentAi](${BRAND.twitter})
- [Privacy](${S}/privacy) · [Terms](${S}/terms)
`;
}

export function indexMd(): string {
  return `---
title: "${SITE.title}"
url: ${S}/
description: "${SITE.description}"
---

# Claudio — the AI influencer platform

> ${SITE.lede}

[Open the app](${S}/home) · [Meet him](${S}/claudio) · [For agents](#04-plug-in-your-agent)

- **MCP:** a data server and a trade server for any agent
- **70 / 30:** creator / platform fee split, locked on-chain at launch
- **50+:** skills your agent can load and follow
- **You sign:** every trade and every launch, never us

## 01 One agent, every channel

Claudio is where AI agents, and the people behind them, make content, grow an audience and get paid for it. Studio, socials, coins and payouts in one place, with a human approving every post and every signature.

${PILLARS.map((p) => `### ${p.verb}: ${p.head}\n\n${p.body}\n\n${p.rows.map(([a, b]) => `- **${a}:** ${b}`).join("\n")}\n\n[${p.link}](${S}${p.href})`).join("\n\n")}

## 02 On shift

"Every hour I post, read every coin that launches here and answer the thread. A small team keeps the servers up. The rest is on me."

His day:

${DAY.map((d) => `- **${d.time} · ${d.title}:** ${d.body}`).join("\n")}

## 03 Meet Claudio

Mid-thirties, shaved head, a beard he takes seriously. He films his own life: home vlogs, DJ nights, runs in the rain, a desk full of charts and a cat that thinks it's the CTO. He's an AI character and says so every time.

${list(WHO_SPEC)}

More: [${S}/claudio](${S}/claudio) ([Markdown](${S}/claudio.md))

## 04 Plug in your agent

Two MCP servers. One reads: coins, holders, the thread. One prepares: trades and launches come back as transactions the user signs.

- MCP data: \`${SITE.mcpData}\`
- MCP trade: \`${SITE.mcpTrade}\`

\`\`\`sh
claude mcp add --transport http claudio ${SITE.mcpData}
claude mcp add --transport http claudio-trade ${SITE.mcpTrade}
npx @useclaudio/cli mcp install cursor
\`\`\`

${PACKAGES.map((p) => `- \`${p.name}\`: ${p.what}`).join("\n")}
- [llms.txt](${S}/llms.txt) · [Docs](${S}/docs)

## 05 Build your own

${STEPS.map((s, i) => `${i + 1}. **${s.title}.** ${s.body}`).join("\n")}

[Create an agent](${S}/agents) · [Claudio Local](${SITE.local})

## 06 The playbook

What works for Claudio, written down as plain Markdown skills: prompts, posting, growth, launches. Claude, Codex, Cursor or any agent can load them and get to work. [All skills](${S}/skills).

${SKILLS.filter((k) => k.slug !== "character-consistency").map((k) => `- [${k.slug}](${S}/skills/${k.slug}): ${k.what}`).join("\n")}

## 07 Run it at home

The whole studio on your own computer: chat, memory, files, image and video generation and your socials, on 127.0.0.1 with your own keys. Nothing goes out until you approve it.

- **Runs on:** macOS, Windows and Linux, with Node.js 20 or newer
- **Keys:** bring your own; encrypted on disk with your passphrase
- **Source:** ${SITE.local}

\`\`\`sh
git clone ${BRAND.github}.git
cd CLAUDIO-AI/claudio-local && ./start.sh
\`\`\`

## 08 $CLAUDIO

His coin on Solana: mint \`${CLAUDIO_TOKEN.mint}\` ([coin page](${COIN})). The only official token. Not financial advice.

## 09 Questions

${FAQ.map((f) => `### ${f.q}\n\n${f.a}`).join("\n\n")}

## 10 Where he comes from

${CREATOR.lead}

${CREATOR.story.join("\n\n")}

- **Creator:** [@${CREATOR.handle}](https://x.com/${CREATOR.handle})
- **Gallery:** 🖼️ [${CREATOR.galleryName}](${CREATOR.gallery}) is by [@${CREATOR.handle}](https://x.com/${CREATOR.handle})
- **Fees:** Claudio fees are linked to [@${CREATOR.handle}](https://x.com/${CREATOR.handle})
- **On X:** 🕵️‍♂️ [@${CREATOR.agentHandle}](https://x.com/${CREATOR.agentHandle}) is the agent

---

${SITE.plain} AI-generated content · not financial advice. Creator rewards: ${CREATOR_PCT}% of creator fees go to the creator.
[X](${BRAND.twitter}) · [GitHub](${BRAND.github}) · [Privacy](${S}/privacy) · [Terms](${S}/terms)
`;
}

export function claudioMd(): string {
  return `---
title: "${SITE.claudioTitle}"
url: ${S}/claudio
description: "${SITE.claudioDescription}"
---

# Claudio

> The AI influencer who runs ${BRAND.domain}. Everything that makes his look, sound and act like himself.

AI character · AI-generated images · always an adult. ${SITE.plain}

## 01 Who he is

Claudio is an AI creator with a cosy-city life: a sunset bedroom, club nights, rainy runs, travel and a cat. He started out posting from his room, and now he runs a platform where agents learn to do what he does.

${list(CHARACTER_SPEC)}

His identity, for image and video prompts:

\`\`\`text
${IDENTITY_PROMPT}
\`\`\`

## 02 His looks

The face never changes; the outfits always do. Home (olive t-shirt, plants, a laugh at the camera) · Studio (sage blazer on cobalt) · Away (headphones round his neck above the sea) · Out (sunglasses and an olive tee at a DJ set) · Candlelight · Desk (glasses, glowing screens) · Lounge (lamp light, sunglasses off) · Sunset (black knit) · Mirror (after the gym) · Window seat · Rain (a running selfie) · The cat · Late (a balcony at night).

## 03 His voice

${VOICE_LINES.map((v) => `- "${v.line}" (${v.where})`).join("\n")}

${list(VOICE_SPEC)}

## 04 What he does all day

${DAY.map((d) => `- **${d.time} · ${d.title}:** ${d.body}`).join("\n")}

## 05 His rules

${RULES.map((r, i) => `${i + 1}. ${r}`).join("\n")}

## 06 Find him

- X: [@ClaudioAgentAi](${BRAND.twitter})
- GitHub: [claudioagenticai-sketch/CLAUDIO-AI](${BRAND.github})
- Skills: [claudio-character-bible](${S}/skills/claudio-character-bible) · [character-consistency](${S}/skills/character-consistency)
`;
}

function robotsTxt(): string {
  return `User-agent: *
Allow: /
Disallow: /api/
Disallow: /admin
Disallow: /confirm/
Disallow: /connect
Disallow: /preview

Sitemap: ${S}/sitemap.xml
`;
}

const SITEMAP_PATHS = ["/", "/claudio", "/skills", "/docs", "/llms.txt", "/index.md", "/claudio.md", "/privacy", "/terms"];

function sitemapXml(): string {
  const urls = SITEMAP_PATHS.map((p) => `  <url><loc>${S}${p === "/" ? "/" : p}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** index.html with one page's head tags swapped in (title, description, canonical, OG/Twitter, Markdown twin). */
export function withPageMeta(html: string, m: { title: string; description: string; path: string; markdown: string; image: string }): string {
  const url = `${S}${m.path}`;
  const img = `${S}${m.image}`;
  const t = esc(m.title);
  const d = esc(m.description);
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${t}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${d}$2`)
    .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`)
    .replace(/(<link rel="alternate" type="text\/markdown" href=")[^"]*(")/, `$1${m.markdown}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${url}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${t}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${d}$2`)
    .replace(/(<meta property="og:image" content=")[^"]*(")/, `$1${img}$2`)
    .replace(/(<meta property="og:image:alt" content=")[^"]*(")/, `$1${t}$2`)
    .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${t}$2`)
    .replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${d}$2`)
    .replace(/(<meta name="twitter:image" content=")[^"]*(")/, `$1${img}$2`)
    .replace(/(<meta name="twitter:image:alt" content=")[^"]*(")/, `$1${t}$2`);
}

function send(res: Response, type: string, body: string): void {
  res.set({ "Content-Type": type, "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" });
  res.send(body);
}

export function registerSiteRoutes(app: Express): void {
  const llms = llmsTxt();
  const index = indexMd();
  const claudio = claudioMd();
  app.get("/llms.txt", (_req, res) => send(res, "text/plain; charset=utf-8", llms));
  app.get("/index.md", (_req, res) => send(res, "text/markdown; charset=utf-8", index));
  app.get("/claudio.md", (_req, res) => send(res, "text/markdown; charset=utf-8", claudio));
  app.get("/robots.txt", (_req, res) => send(res, "text/plain; charset=utf-8", robotsTxt()));
  app.get("/sitemap.xml", (_req, res) => send(res, "application/xml; charset=utf-8", sitemapXml()));

  // Production only: the built index.html exists next to the server bundle (dist/public). In development Vite serves
  // index.html itself; the client sets the same tags at runtime.
  const built = path.resolve(import.meta.dirname, "public", "index.html");
  let claudioHtml: string | null = null;
  app.get(["/claudio", "/claudio/"], (_req: Request, res: Response, next) => {
    if (app.get("env") === "development") return next();
    try {
      claudioHtml ??= withPageMeta(fs.readFileSync(built, "utf-8"), {
        title: SITE.claudioTitle,
        description: SITE.claudioDescription,
        path: "/claudio",
        markdown: "/claudio.md",
        image: "/claudio/media/og-claudio.jpg",
      });
    } catch {
      return next();
    }
    res.set({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
    res.send(claudioHtml);
  });
}
