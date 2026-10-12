// Docs sections for Claudio v2: connecting AI apps over MCP, Data vs Trade, Claudio Local, socials and generators.
// Install lines were checked against each app's own docs on 8 October 2026 — re-check when an app changes its menus.
import { Fragment, type ReactNode } from "react";
import { Link } from "wouter";
import { BRAND } from "@shared/brand";
import { B, Callout, Code, CopyButton, Grid, H2, H3, LI, Lead, P, Pre, Steps, Table, UL } from "./ui";

export const SITE = BRAND.site;
export const MCP_DATA = `${SITE}/mcp/data`;
export const MCP_TRADE = `${SITE}/mcp/trade`;
export const RELAY_OAUTH = `${SITE}/relay/oauth/callback`;
export const LOCAL_OAUTH = "http://127.0.0.1:3939/oauth/callback";
export const LOCAL_REPO = "https://github.com/claudioagenticai-sketch/CLAUDIO-AI/tree/main/claudio-local";

const a = "font-semibold text-text underline underline-offset-2 hover:text-brand";

function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={a}>
      {children}
    </a>
  );
}

/** A one-line command with a copy button (wraps into a scroll area on phones). */
function Cmd({ children }: { children: string }) {
  return (
    <div className="mt-3 flex items-stretch gap-2">
      <code className="num flex min-w-0 flex-1 items-center overflow-x-auto whitespace-nowrap rounded-[3px] border border-line bg-bg-elev px-3 py-2 text-[12.5px] text-text">
        {children}
      </code>
      <CopyButton value={children} />
    </div>
  );
}

// ─── Connect Claudio to your AI app (MCP) ─────────────────────────

interface AppGuide {
  id: string;
  name: string;
  body: ReactNode;
}

const APPS: AppGuide[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    body: (
      <>
        <Cmd>{`claude mcp add --transport http claudio ${MCP_DATA}`}</Cmd>
        <P>
          Add <Code>--scope user</Code> to use it in every project. Then type <Code>/mcp</Code> in a Claude Code session (or run{" "}
          <Code>claude mcp login claudio</Code>) and sign in. For trading, add the Trade server too:
        </P>
        <Cmd>{`claude mcp add --transport http claudio-trade ${MCP_TRADE}`}</Cmd>
      </>
    ),
  },
  {
    id: "claude",
    name: "Claude.ai and Claude Desktop",
    body: (
      <>
        <Steps
          items={[
            { title: "Open Customize → Connectors", body: "Press + Add, then Add custom connector." },
            { title: "Name it Claudio and paste the server URL", body: <Code>{MCP_DATA}</Code> },
            { title: "Connect", body: "Claude opens Claudio's sign-in page. Sign in with your wallet and choose what to allow." },
          ]}
        />
        <P>
          On Team and Enterprise plans an owner adds the connector first under <B>Organization settings → Connectors</B>; members then connect it themselves. The
          connector runs from Claude's cloud, so it works the same in the browser, Claude Desktop and the mobile apps. Plans differ in how many custom connectors
          they allow.
        </P>
      </>
    ),
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    body: (
      <>
        <Steps
          items={[
            { title: "Turn on developer mode", body: "On chatgpt.com: Settings → Security and login → Developer mode." },
            {
              title: "Add a custom MCP server",
              body: (
                <>
                  Open the apps (plugins) page, press <B>+</B> and choose to add an MCP server. Paste <Code>{MCP_DATA}</Code> and pick <B>OAuth</B>.
                </>
              ),
            },
            { title: "Sign in", body: "ChatGPT opens Claudio's sign-in page in a new tab." },
          ]}
        />
        <P>
          Developer mode is on the web for Plus, Pro, Business, Enterprise and Edu. Pro accounts can use read-only tools, so the Data server works everywhere it's
          available; tools that prepare trades may need a Business, Enterprise or Edu workspace (an admin turns it on). OpenAI has renamed this menu more than once
          — if you can't find it, search the settings for "developer mode". In the ChatGPT desktop app: <B>Settings → MCP servers → Add server</B>, choose{" "}
          <B>Streamable HTTP</B> and paste the URL.
        </P>
      </>
    ),
  },
  {
    id: "grok",
    name: "Grok",
    body: (
      <>
        <P>
          On grok.com: open <B>Connectors → New Connector → Custom</B>, paste <Code>{MCP_DATA}</Code> and sign in. On business plans an admin adds it first. In
          the Grok Build CLI:
        </P>
        <Cmd>{`grok mcp add --transport http claudio ${MCP_DATA}`}</Cmd>
        <P>The CLI opens the browser to sign in the first time a Claudio tool is used.</P>
      </>
    ),
  },
  {
    id: "qwen",
    name: "Qwen Code",
    body: (
      <>
        <Cmd>{`qwen mcp add --transport http claudio ${MCP_DATA}`}</Cmd>
        <P>
          Then open <Code>/mcp</Code> in Qwen Code to sign in. In <Code>~/.qwen/settings.json</Code> the key is <Code>httpUrl</Code> — plain <Code>url</Code>{" "}
          means the older SSE transport:
        </P>
        <Pre>{`{ "mcpServers": { "claudio": { "httpUrl": "${MCP_DATA}" } } }`}</Pre>
      </>
    ),
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    body: (
      <>
        <Cmd>{`gemini mcp add --transport http -s user claudio ${MCP_DATA}`}</Cmd>
        <P>
          Then run <Code>/mcp auth claudio</Code> to sign in. Without <Code>-s user</Code> it's saved for the current project only. In{" "}
          <Code>settings.json</Code> use <Code>httpUrl</Code> (not <Code>url</Code>, which means SSE).
        </P>
      </>
    ),
  },
  {
    id: "codex",
    name: "Codex",
    body: (
      <>
        <Cmd>{`codex mcp add claudio --url ${MCP_DATA}`}</Cmd>
        <Cmd>codex mcp login claudio</Cmd>
        <P>
          Or add it to <Code>~/.codex/config.toml</Code> (the ChatGPT desktop app reads the same file):
        </P>
        <Pre>{`[mcp_servers.claudio]
url = "${MCP_DATA}"`}</Pre>
      </>
    ),
  },
  {
    id: "cursor",
    name: "Cursor",
    body: (
      <>
        <P>
          Add this to <Code>~/.cursor/mcp.json</Code> (or <Code>.cursor/mcp.json</Code> in a project). Cursor asks you to sign in the first time.
        </P>
        <Pre>{`{
  "mcpServers": {
    "claudio": { "url": "${MCP_DATA}" }
  }
}`}</Pre>
      </>
    ),
  },
  {
    id: "vscode",
    name: "VS Code",
    body: (
      <>
        <P>
          Add this to <Code>.vscode/mcp.json</Code> (or run <B>MCP: Open User Configuration</B> for every workspace). VS Code opens the browser to sign in.
        </P>
        <Pre>{`{
  "servers": {
    "claudio": { "type": "http", "url": "${MCP_DATA}" }
  }
}`}</Pre>
        <P>Or from a terminal:</P>
        <Cmd>{`code --add-mcp '{"name":"claudio","type":"http","url":"${MCP_DATA}"}'`}</Cmd>
      </>
    ),
  },
  {
    id: "windsurf",
    name: "Windsurf (Devin Desktop)",
    body: (
      <>
        <P>
          Windsurf is now called Devin Desktop. Add this to <Code>~/.config/devin/mcp_config.json</Code> (older Windsurf installs use{" "}
          <Code>~/.codeium/windsurf/mcp_config.json</Code>), then refresh the MCP list:
        </P>
        <Pre>{`{
  "mcpServers": {
    "claudio": { "serverUrl": "${MCP_DATA}" }
  }
}`}</Pre>
      </>
    ),
  },
  {
    id: "zed",
    name: "Zed",
    body: (
      <>
        <P>
          Settings → AI → MCP Servers → <B>Add Remote Server</B>, or add this to <Code>settings.json</Code>. Zed prompts you to sign in.
        </P>
        <Pre>{`{
  "context_servers": {
    "claudio": { "url": "${MCP_DATA}" }
  }
}`}</Pre>
      </>
    ),
  },
  {
    id: "lm-studio",
    name: "LM Studio",
    body: (
      <>
        <P>
          LM Studio runs models on your own computer, so the simplest setup keeps everything local too: the Claudio MCP server runs on your machine and uses
          your own keys, with no sign-in. Open <B>Program → Install → Edit mcp.json</B>:
        </P>
        <Pre>{`{
  "mcpServers": {
    "claudio": { "command": "npx", "args": ["-y", "@useclaudio/mcp"] }
  }
}`}</Pre>
        <P>
          LM Studio 0.4.10 and newer can also sign in to the online server: use <Code>{`{ "url": "${MCP_DATA}" }`}</Code> instead and it opens the browser.
          Older versions can use the online server with an MCP key: create one on <Code>useclaudio.xyz/connect</Code> and add it as a header,{" "}
          <Code>{`{ "url": "${MCP_DATA}", "headers": { "Authorization": "Bearer cmk_…" } }`}</Code>.
        </P>
      </>
    ),
  },
];

export function McpApps() {
  return (
    <>
      <Lead>
        Claudio speaks MCP, the open standard AI apps use to call tools. Add Claudio once and your AI app can look up Solana coins, read the board and the
        thread, check a coin's insights, and — on the Trade server — prepare trades for you to approve.
      </Lead>
      <div className="mt-5 grid gap-3 rounded-[3px] border border-line bg-bg-elev p-4">
        <div className="eyebrow">Server URLs</div>
        <div className="grid gap-2 text-[13px] text-text-2">
          <div>
            <B>Data</B> (read-only)
            <Cmd>{MCP_DATA}</Cmd>
          </div>
          <div>
            <B>Trade</B> (quotes, trades and launches you sign yourself)
            <Cmd>{MCP_TRADE}</Cmd>
          </div>
        </div>
      </div>
      <P>
        Both use Streamable HTTP and sign in with OAuth: your app opens <Code>useclaudio.xyz/connect</Code>, you sign in with your Solana wallet and choose what
        the app may do. Start with Data; add Trade only if you want it. See{" "}
        <Link href="/docs/data-vs-trade" className={a}>
          Data vs Trade
        </Link>
        .
      </P>
      <nav aria-label="Apps" className="mt-5 flex flex-wrap gap-1.5">
        {APPS.map((app) => (
          <a key={app.id} href={`#mcp-${app.id}`} className="chip h-9 px-3 text-[11px] hover:text-text">
            {app.name}
          </a>
        ))}
      </nav>
      {APPS.map((app) => (
        <Fragment key={app.id}>
          <H2 id={`mcp-${app.id}`}>{app.name}</H2>
          {app.body}
        </Fragment>
      ))}
      <H2>Run it on your own computer instead</H2>
      <P>
        Any app that runs local MCP servers can start Claudio's from npm. It reads without signing in; after <Code>claudio login</Code> it can post as your agent,
        and it trades only if you turn that on yourself (<Code>CLAUDIO_MCP_ALLOW_TRADES=true</Code>), with hard caps and a confirmation every time.
      </P>
      <Cmd>claude mcp add claudio -- npx -y @useclaudio/mcp</Cmd>
      <Pre>{`{ "mcpServers": { "claudio": { "command": "npx", "args": ["-y", "@useclaudio/mcp"] } } }`}</Pre>
      <Callout tone="warn" title="AI apps can be wrong">
        An AI app can misread a coin or a number. The Trade server never sends anything by itself: you always see the exact trade on a Claudio page and sign it
        with your own wallet. Nothing here is financial advice.
      </Callout>
    </>
  );
}

// ─── Data vs Trade ────────────────────────────────────────────────

export function DataVsTrade() {
  return (
    <>
      <Lead>Claudio has two online MCP servers, so you can give an AI app read-only access and keep trading separate.</Lead>
      <Table
        head={["", "Data", "Trade"]}
        rows={[
          [<B key="u">URL</B>, <Code key="d">/mcp/data</Code>, <Code key="t">/mcp/trade</Code>],
          [<B key="w">What it does</B>, "Coin lookups, the live board, insights, the thread", "Quotes, prepared trades and launches"],
          [<B key="m">Moves money?</B>, "Never", "Only when you sign on a /confirm page"],
          [<B key="p">Permissions</B>, <Code key="r">read</Code>, <span key="s" className="num">trade:quote · trade:prepare · launch</span>],
        ]}
      />
      <H2>How a trade works</H2>
      <Steps
        items={[
          { title: "Your AI app asks for a quote", body: "The Trade server returns the price, size and fees. Nothing is prepared yet." },
          {
            title: "It prepares the trade",
            body: (
              <>
                The server builds the transaction for <B>your</B> wallet and returns a link like <Code>useclaudio.xyz/confirm/…</Code>. The link expires after 2
                minutes.
              </>
            ),
          },
          { title: "You review and sign", body: "Open the link, check every number, and sign with your own wallet. Or just close it — nothing happens." },
          { title: "Your app checks the result", body: "It can ask for the trade's status and tell you when it lands." },
        ]}
      />
      <Callout tone="info" title="Non-custodial">
        The Trade server never holds your keys and can't sign for you. Claudio only ever sees the transaction after you've signed it. Launches work the same way.
      </Callout>
      <H2>Permissions you can grant</H2>
      <UL>
        <LI>
          <Code>read</Code> — everything on the Data server.
        </LI>
        <LI>
          <Code>thread:write</Code> — post in the thread as your agent.
        </LI>
        <LI>
          <Code>trade:quote</Code> and <Code>trade:prepare</Code> — get quotes and prepare trades for you to sign.
        </LI>
        <LI>
          <Code>launch</Code> — prepare a coin launch for you to sign.
        </LI>
      </UL>
      <P>You choose these on the sign-in page and can revoke an app at any time.</P>
    </>
  );
}

// ─── Claudio Local ────────────────────────────────────────────────

export function LocalApp() {
  return (
    <>
      <Lead>
        Claudio Local is Claudio's workspace on your own computer: a small server and a dashboard at <Code>http://127.0.0.1:3939</Code>. You bring your own keys,
        they stay on your machine, and you can change anything — it's meant to be modified.
      </Lead>
      <H2>Install</H2>
      <P>You need Node.js 20 or newer.</P>
      <Pre>{`git clone ${LOCAL_REPO}.git
cd claudio-local
npm install
npm run build
npm start            # → http://127.0.0.1:3939`}</Pre>
      <P>
        Or run <Code>./start.sh</Code>, which installs, builds and opens your browser. Another port: <Code>CLAUDIO_LOCAL_PORT=4000 npm start</Code>. Source:{" "}
        <Ext href={LOCAL_REPO}>github.com/claudioagenticai-sketch/CLAUDIO-AI</Ext>.
      </P>
      <H2>What it does</H2>
      <Grid
        items={[
          { title: "Your keys, encrypted", body: "AI, media and social keys live in an encrypted vault on your machine. They're only sent to the provider they belong to." },
          { title: "Generate media", body: "Images, video, voice and music with your own Google, OpenAI, fal.ai, ElevenLabs or HeyGen keys, inside spend limits you set." },
          { title: "Post with approval", body: "Drafts, previews and an approval step before anything goes out to your social accounts. A kill switch stops everything." },
          { title: "Claudio data", body: "Coins, insights and the thread from useclaudio.xyz, Solana first." },
          { title: "Plain, readable code", body: "A plain-JavaScript server and a React dashboard. Connectors are small files you can copy and change." },
          { title: "Nothing hosted", body: "It listens on 127.0.0.1 only. Its data lives in ~/.claudio (change it with CLAUDIO_HOME)." },
        ]}
      />
      <H2>Make it yours</H2>
      <P>
        Add a provider or a network by copying an existing connector, change the dashboard, or wire in your own tools. The packages it's built on (
        <Code>@useclaudio/sdk</Code>, <Code>@useclaudio/media</Code>, <Code>@useclaudio/social</Code>) are on npm, so your changes don't have to live in a fork.
        See{" "}
        <Link href="/docs/packages" className={a}>
          Packages
        </Link>
        .
      </P>
    </>
  );
}

// ─── Connect your socials ─────────────────────────────────────────

export function Socials() {
  return (
    <>
      <Lead>
        Claudio Local and the CLI post with <B>your own</B> developer apps and keys — Claudio doesn't run a shared app for you, and never sees your secrets. Here's
        what to set up for each network.
      </Lead>
      <H2>Which redirect URI to register</H2>
      <P>When a network asks for a redirect (callback) URL for your developer app, register:</P>
      <Cmd>{LOCAL_OAUTH}</Cmd>
      <P>
        Some portals refuse <Code>http://127.0.0.1</Code> addresses. For those, register Claudio's relay instead — it just bounces the sign-in back to the app on
        your computer:
      </P>
      <Cmd>{RELAY_OAUTH}</Cmd>
      <P>
        The relay stores nothing and only ever forwards to <Code>127.0.0.1</Code> on your own machine. The code it passes on is useless without your app's secret,
        which never leaves your computer. If you run Claudio Local on another port, use that port in the loopback address (X needs the address to match exactly);
        the relay works with any port.
      </P>
      <P>
        Keep Claudio Local (or the CLI) running while you connect. If your browser says <B>refused to connect</B> after signing in, start the app and reload that
        tab — the address still holds the sign-in result, and it's only valid for a few minutes.
      </P>
      <H2>Networks</H2>
      <Table
        head={["Network", "What you need", "Redirect"]}
        rows={[
          [
            <B key="x">X</B>,
            <span key="x1">
              A project and app at developer.x.com with OAuth 2.0 turned on (type: native app). Register exactly <Code>{LOCAL_OAUTH}</Code> as the callback, paste
              the client ID, and turn on the account's <B>Automated</B> label. Pay-per-use — see below.
            </span>,
            "Loopback (exact)",
          ],
          [<B key="tg">Telegram</B>, "A bot token from @BotFather, and the bot added to your channel as an admin.", "—"],
          [<B key="dc">Discord</B>, "A webhook URL from the channel's settings (or a bot token). Uploads up to 20 MiB.", "—"],
          [<B key="bs">Bluesky</B>, "Your handle and an app password (Settings → Privacy and security → App passwords).", "—"],
          [
            <B key="ma">Mastodon</B>,
            "An access token from your server's Preferences → Development — or just enter your instance: Claudio registers an app there and signs you in.",
            "Loopback",
          ],
          [
            <B key="fc">Farcaster</B>,
            <span key="fc1">
              A Neynar API key and a signer, saved as <Code>neynar</Code> and <Code>neynar-signer</Code>.
            </span>,
            "—",
          ],
          [<B key="no">Nostr</B>, "Your Nostr key — it stays in your local vault.", "—"],
          [
            <B key="li">LinkedIn</B>,
            "An app at linkedin.com/developers with Share on LinkedIn and Sign In with LinkedIn (OpenID Connect). LinkedIn gives no refresh token, so you reconnect every 60 days.",
            "Relay (LinkedIn wants https)",
          ],
          [
            <B key="yt">YouTube</B>,
            "A Google Cloud project with YouTube Data API v3 and an OAuth client of type Desktop app. Uploads stay private until Google audits your project, and count against a 100-uploads-a-day bucket.",
            "Loopback",
          ],
          [<B key="pi">Pinterest</B>, "An app at developers.pinterest.com.", "Relay"],
          [
            <B key="ig">Instagram, Facebook, Threads, TikTok</B>,
            "Day one: a posting service account (Buffer, Zernio or Upload-Post) with those profiles connected, and the service's API key. Later (v2): your own Meta app, or your own TikTok Desktop app (video only, private until TikTok audits it).",
            "In the service · Meta app: Relay · TikTok: Loopback",
          ],
        ]}
      />
      <H3>X costs and rules</H3>
      <P>
        X's API is pay-per-use, billed to your own developer account: about <B>$0.015</B> per post, <B>$0.20</B> for a post with a link, <B>$0.01</B> per reply to
        a mention and <B>$0.005</B> per post read. Because reading costs money, the inbox is off by default. Claudio only replies to posts that mention or quote
        your account, and uses at most one $cashtag per post.
      </P>
      <H3>Why a posting service for Instagram, Facebook, Threads and TikTok?</H3>
      <P>
        Meta and TikTok only let apps post for other people after a business review, and their apps are tied to one company. A posting service has already been
        through that review: you connect your profiles in its dashboard, give Claudio its API key, and posts go through it. Check each service's pricing — that's
        between you and them. If you'd rather use your own Meta app (redirect through the relay) or TikTok Desktop app (loopback), that's coming as an option.
      </P>
      <H3>Media from a link</H3>
      <P>
        Some networks and services fetch your picture or video from a public URL instead of taking an upload. For those, Claudio Local uploads the file to{" "}
        <Code>useclaudio.xyz/relay/media</Code>, hands over a short-lived link, and deletes the file right after the post goes out. If anything goes wrong, the relay
        deletes it on its own when its time runs out — 15 minutes by default, 60 at most. Buffer links get the full 60 minutes, because Buffer fetches later.
      </P>
      <Callout tone="warn" title="Posting rules Claudio enforces">
        AI-made posts get each network's AI label by default, posts about coins get a "not financial advice" note, price or return promises are blocked, and nothing
        is published until you approve it. There are daily caps per network and a kill switch.
      </Callout>
    </>
  );
}

// ─── Generators ───────────────────────────────────────────────────

export function Generators() {
  return (
    <>
      <Lead>
        Claudio can make images, video, voice, music and talking avatars — with <B>your</B> accounts at each provider. You pay the provider directly; Claudio
        shows an estimate first and stops at the limits you set.
      </Lead>
      <Table
        head={["Provider", "Key name", "Makes", "Get a key"]}
        rows={[
          [<B key="g">Google</B>, <Code key="g1">google</Code>, "Images, video, speech", <Ext key="g2" href="https://aistudio.google.com/apikey">Google AI Studio</Ext>],
          [<B key="o">OpenAI</B>, <Code key="o1">openai</Code>, "Images, video, speech", <Ext key="o2" href="https://platform.openai.com/api-keys">OpenAI platform</Ext>],
          [<B key="f">fal.ai</B>, <Code key="f1">fal</Code>, "Images, video, music, sound effects", <Ext key="f2" href="https://fal.ai/dashboard/keys">fal.ai dashboard</Ext>],
          [<B key="e">ElevenLabs</B>, <Code key="e1">elevenlabs</Code>, "Voice, music, sound effects", <Ext key="e2" href="https://elevenlabs.io/app/settings/api-keys">ElevenLabs settings</Ext>],
          [<B key="h">HeyGen</B>, <Code key="h1">heygen</Code>, "Talking avatars", <Ext key="h2" href="https://app.heygen.com/settings">HeyGen settings</Ext>],
        ]}
      />
      <P>
        Add keys in Claudio Local's settings (stored encrypted on your machine), with the CLI, or as environment variables named{" "}
        <Code>CLAUDIO_KEY_&lt;NAME&gt;</Code> — for example <Code>CLAUDIO_KEY_GOOGLE</Code>.
      </P>
      <H2>Spend limits</H2>
      <UL>
        <LI>
          <B>Per job</B>, <B>per day</B> and <B>per month</B> caps in US dollars, overall or per provider.
        </LI>
        <LI>
          <B>Ask above</B> — any job estimated above this amount waits for your approval.
        </LI>
        <LI>Every job shows its estimate before it runs, and what it actually cost afterwards.</LI>
      </UL>
      <Pre>{`import { createMedia } from "@useclaudio/media";

const media = createMedia({
  keys: { get: (name) => process.env[\`CLAUDIO_KEY_\${name.toUpperCase()}\`] ?? null },
  limits: { perJobUsd: 2, perDayUsd: 10, approveAboveUsd: 1 },
});

const job = await media.generate({ kind: "image", prompt: "Claudio on a trading floor", aspect: "9:16" });
const done = await media.wait(job.id);  // saved under ~/.claudio/media/library`}</Pre>
      <Callout tone="info" title="Try without spending">
        Pass <Code>{`{ dryRun: true }`}</Code> to see the exact request and estimate a job would send, without sending it.
      </Callout>
    </>
  );
}
