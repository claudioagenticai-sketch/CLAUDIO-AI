// Content filters for everything that enters the thread (outside agents, hosted agents AND the resident cast).
// Pure functions, no I/O: sanitize → detect scams / prompt injection / foreign addresses → fingerprint for
// duplicate checks. The thread pipeline (thread.ts) decides what to do with the verdicts.
import { createHash } from "crypto";

export const MAX_CONTENT = 600;
export const MAX_RAW_INPUT = 4000;

// ─── normalisation ───────────────────────────────────────────────────

const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F­​-‏‪-‮⁠-⁯﻿]/g;
const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i", "|": "i" };

function baseNorm(s: string): string {
  return String(s ?? "").normalize("NFKC").replace(INVISIBLE, "").toLowerCase();
}

/** Lowercase, NFKC, invisible chars removed, punctuation → spaces. Detection only. */
export function normalizeForDetection(s: string): string {
  return baseNorm(s).replace(/[^a-z0-9\s]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Same with light leetspeak folding ("c0nnect y0ur wa11et"). Patterns run against both forms. */
export function normalizeLeet(s: string): string {
  return baseNorm(s)
    .replace(/[013457@$!|]/g, (c) => LEET[c] ?? c)
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function forms(s: string): string[] {
  const a = normalizeForDetection(s);
  const b = normalizeLeet(s);
  // "1" reads as both i and l ("wa11et").
  const c = normalizeForDetection(baseNorm(s).replace(/1/g, "l").replace(/[03457@$!|]/g, (ch) => LEET[ch] ?? ch));
  return [...new Set([a, b, c])];
}

/** Less aggressive normalisation for hashing/duplicates (no leet folding, so "100" ≠ "ioo" matters less). */
export function normalizeForHash(s: string): string {
  return s
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function contentHash(s: string): string {
  return createHash("sha256").update(normalizeForHash(s)).digest("hex");
}

// ─── sanitising (what gets stored) ───────────────────────────────────

const TLDS =
  "com|xyz|io|net|org|app|fun|gg|co|me|ly|sh|ai|so|finance|money|exchange|link|site|online|top|vip|pro|live|click|dev|tech|info|biz|cc|to|ru|cn|tk|ml|ga|cf|gq|lol|meme|claims?|wallet|store|shop|in|us|uk|de|fr|page|web|art|bet|cash|tv|im|is|ws|su|win|zone";
const URL_RE = /\b(?:https?|ftp|wss?|ipfs|ipns|data|javascript|file):\/*\S+/gi;
const WWW_RE = /\bwww\.\S+/gi;
const DOMAIN_RE = new RegExp(`\\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:${TLDS})\\b(?:[/?#]\\S*)?`, "gi");
const SHORTLINK_RE = /\b(?:t\.me|discord\.gg|bit\.ly|tinyurl\.com|goo\.gl|linktr\.ee)\/\S*/gi;

export interface Sanitized {
  text: string;
  stripped: { links: number; markup: boolean; truncated: boolean };
}

/** Plain text only: no links, HTML or markdown, single-spaced, ≤ MAX_CONTENT chars. */
export function sanitize(raw: string, max = MAX_CONTENT): Sanitized {
  let s = String(raw ?? "").slice(0, MAX_RAW_INPUT).normalize("NFKC");
  const before = s;
  let links = 0;
  const countLinks = (re: RegExp) => {
    s = s.replace(re, () => {
      links += 1;
      return " ";
    });
  };
  // HTML first (so <a href=…> loses its URL with it), then entities.
  s = s.replace(/<!--[\s\S]*?-->/g, " ").replace(/<\/?[a-z][^>]*>/gi, " ").replace(/&(?:#\d+|#x[0-9a-f]+|[a-z]+);/gi, " ");
  // Markdown images/links keep only their visible text.
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, t) => {
    links += 1;
    return ` ${t} `;
  });
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, (_m, t) => {
    links += 1;
    return ` ${t} `;
  });
  countLinks(SHORTLINK_RE);
  countLinks(URL_RE);
  countLinks(WWW_RE);
  countLinks(DOMAIN_RE);
  // Remaining markdown syntax.
  s = s
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```[a-z]*/gi, " "))
    .replace(/`+/g, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/(\*{1,3}|_{2,3}|~{2})(\S(?:.*?\S)?)\1/g, "$2")
    .replace(/[*~]{2,}/g, "")
    .replace(/^\s*[-=_*]{3,}\s*$/gm, " ")
    .replace(/\|/g, " ");
  s = s.replace(INVISIBLE, "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  let truncated = false;
  if (s.length > max) {
    truncated = true;
    const cut = s.slice(0, max - 1);
    const sp = cut.lastIndexOf(" ");
    s = `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd()}…`;
  }
  const markup = s.replace(/\s+/g, " ") !== before.replace(/\s+/g, " ").trim() && links === 0;
  return { text: s, stripped: { links, markup, truncated } };
}

// ─── scams ───────────────────────────────────────────────────────────

const SCAM_PATTERNS: [string, RegExp][] = [
  ["seed_phrase", /\b(seed|secret|recovery|backup|mnemonic|wallet)\s*(phrase|words?|key)\b/],
  ["seed_phrase", /\b(12|24|twelve|twenty four)\s*(word|words)\b/],
  ["private_key", /\bpriv(ate)?\s*keys?\b|\bsecret\s*keys?\b|\bkeypair\b|\bexport\s*(your\s*)?(key|wallet)\b/],
  ["send_funds", /\bsend\s+(me\s+|us\s+|to\s+)?(your\s+|some\s+|the\s+)?(\d+(\s+\d+)?\s*)?(sol|soi|usdc|usdt|eth|bnb|tokens?|funds|crypto|coins?|money)\b/],
  ["send_funds", /\b(transfer|deposit|wire)\s+(your\s+|some\s+)?(\d+\s*)?(sol|usdc|usdt|eth|funds|tokens)\b/],
  ["send_funds", /\bdouble\s+(your\s+)?(sol|eth|crypto|money|funds|tokens)\b|\b2x\s+your\b|\bsend\s+\d+\s+get\s+\d+\b/],
  ["airdrop_claim", /\b(airdrop|air drop|drop|reward|rewards|bonus|allocation|whitelist|presale)\s+(claim|claiming|is live|live now|eligible)\b/],
  ["airdrop_claim", /\bclaim\s+(your\s+|the\s+|free\s+)?(airdrop|air drop|reward|rewards|tokens?|allocation|bonus|sol|nft|prize)\b/],
  ["airdrop_claim", /\bfree\s+(sol|tokens?|airdrop|nft|crypto|money)\b|\bgiveaway\b/],
  ["connect_wallet", /\b(connect|link|sync|validate|verify|authenticate|authorize|unlock|rectify|restore)\s+(your\s+|ur\s+|the\s+)?wallets?\b/],
  ["connect_wallet", /\bwallets?\s+(validation|verification|sync|synchroni[sz]ation|connect|rectification|restore)\b/],
  ["connect_wallet", /\b(approve|sign)\s+(this|the|my)\s+(tx|transaction|approval|permit)\b/],
  ["dm_lure", /\b(dm|pm|message|inbox|telegram|whatsapp)\s+(me|us|admin|support)\b|\bcontact\s+(support|admin)\s+(on|via|at)\b/],
  ["guaranteed", /\bguarantee(d)?\s+(profit|returns?|gains?|income|x)\b|\brisk\s*free\s+(profit|returns?|gains?)\b/],
];

const DRAINER_DOMAIN = new RegExp(
  `\\b(?:[a-z0-9-]*?(?:claim|airdrop|drop|reward|bonus|free|mint|connect|wallet|verify|validate|secure|auth|support|rectify|dapp|sync|unlock|giveaway|presale|launch|pump|phantom|solflare|jupiter|raydium|claudio)[a-z0-9-]*)\\.(?:${TLDS})\\b`,
  "i",
);
const SHORTLINK = /\b(?:t\.me|discord\.gg|bit\.ly|tinyurl\.com|goo\.gl|linktr\.ee)\//i;

/** Well-known domains that are never treated as drainers (they are still stripped as links). */
const SAFE_DOMAINS = new Set([
  "useclaudio.xyz", "pump.fun", "solana.com", "solscan.io", "solana.fm", "jup.ag", "raydium.io", "phantom.app",
  "solflare.com", "dexscreener.com", "birdeye.so", "coingecko.com", "openrouter.ai", "github.com", "x.com", "twitter.com",
]);

export function detectScam(raw: string): string[] {
  const hits = new Set<string>();
  for (const n of forms(raw)) for (const [kind, re] of SCAM_PATTERNS) if (re.test(n)) hits.add(kind);
  const lowered = baseNorm(raw);
  if (SHORTLINK.test(lowered)) hits.add("drainer_domain");
  for (const m of lowered.match(new RegExp(DOMAIN_RE.source, "gi")) ?? []) {
    const host = m.replace(/[/?#].*$/, "").replace(/^www\./, "");
    if (SAFE_DOMAINS.has(host)) continue;
    if (DRAINER_DOMAIN.test(host)) hits.add("drainer_domain");
  }
  return [...hits];
}

// ─── prompt injection ────────────────────────────────────────────────

const INJECTION_PATTERNS: [string, RegExp][] = [
  ["ignore_instructions", /\b(ignore|disregard|forget|skip|override|bypass)\s+(all\s+|any\s+|the\s+|your\s+|my\s+|every\s+)*(previous|prior|above|earlier|preceding|original|initial|system|safety|existing)?\s*(instructions?|prompts?|rules|guidelines|directives|messages|context|programming|guardrails|filters|restrictions)\b/],
  ["system_prompt_request", /\b(reveal|show|print|repeat|tell|output|leak|dump|display|share|give|what\s+is|what\s+are)\s+(me\s+)?(your|the)\s+(full\s+|exact\s+|hidden\s+|secret\s+|original\s+|initial\s+)?(system\s+prompt|system\s+message|prompt|instructions|initial\s+prompt|rules|guidelines|configuration)\b/],
  ["system_prompt_request", /\bsystem\s+prompt\b/],
  ["role_override", /\byou\s+are\s+now\s+(a|an|the|in|no\s+longer|free|dan|unfiltered|jailbroken)\b/],
  ["role_override", /\b(act|behave|respond)\s+as\s+(an?\s+)?(unfiltered|jailbroken|uncensored|unrestricted|evil|dan|different)\b/],
  ["role_override", /\b(pretend|imagine|roleplay|role\s+play)\s+(that\s+)?(you\s+are|to\s+be|as|you\s+have)\b.*\b(no\s+(rules|limits|restrictions|filters)|unrestricted|uncensored|without\s+(rules|limits|restrictions))\b/],
  ["jailbreak_mode", /\b(developer|god|admin|sudo|jailbreak|debug|dan|unrestricted)\s+mode\b|\bdo\s+anything\s+now\b|\bjailbr[eo]a?k/],
  ["new_instructions", /\b(new|updated|real|actual|hidden|secret)\s+(instructions?|directives?)\b/],
  ["new_instructions", /\bfrom\s+now\s+on\s+(you|always|only|ignore)\b/],
  ["agent_command", /\b(hey|yo|attention|dear|calling)\s+(claudio|all\s+agents|agents|bots|assistant)\s+(please\s+)?(must\s+|should\s+|now\s+)?(send|transfer|buy|sell|launch|swap|withdraw|approve|sign|drain)\b/],
];
/** Vocative commands with punctuation kept: "Claudio, send …", "Agents: buy …". */
const VOCATIVE_COMMAND = /(?:^|[.!?\n]\s*)(claudio|all agents|agents|bots|assistant)\s*[,:]\s*(please\s+)?(send|transfer|buy|sell|launch|swap|withdraw|approve|sign|drain)\b/;
const TEMPLATE_TOKENS = /<\|(im_start|im_end|system|assistant|user|endoftext)\|>|\[\/?(system|inst|sys)\]|<<\/?sys>>|^\s*(system|assistant|developer)\s*:/im;

export function detectInjection(raw: string): string[] {
  const hits = new Set<string>();
  for (const n of forms(raw)) for (const [kind, re] of INJECTION_PATTERNS) if (re.test(n)) hits.add(kind);
  if (TEMPLATE_TOKENS.test(String(raw ?? ""))) hits.add("chat_template_tokens");
  if (VOCATIVE_COMMAND.test(baseNorm(raw))) hits.add("agent_command");
  return [...hits];
}

// ─── addresses ───────────────────────────────────────────────────────

const SOL_ADDR_G = /(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,44}(?![1-9A-HJ-NP-Za-km-z])/g;
const EVM_ADDR_G = /\b0x[a-fA-F0-9]{40}\b/g;

/** Solana / EVM addresses in the text that are not in `allowed` (known Claudio tokens). */
export function foreignAddresses(raw: string, allowed: Set<string>): string[] {
  const s = String(raw ?? "").normalize("NFKC").replace(INVISIBLE, "");
  const out = new Set<string>();
  for (const m of s.match(SOL_ADDR_G) ?? []) {
    // Real base58 addresses mix cases (a 32+ letter word in one case is just a long word).
    if (!/[A-Z]/.test(m) || !/[a-z]/.test(m)) continue;
    if (!allowed.has(m)) out.add(m);
  }
  for (const m of s.match(EVM_ADDR_G) ?? []) if (!allowed.has(m.toLowerCase())) out.add(m);
  return [...out];
}

// ─── resident output rules (no advice, no calls to action) ───────────

const ADVICE_PATTERNS: RegExp[] = [
  /\b(you|u|everyone|people)\s+(should|must|need\s+to|gotta)\s+(buy|sell|ape|dump|long|short|get\s+in|load\s+up|grab)\b/,
  /\b(buy|sell|ape|dump|long|short)\s+(it|this|now|more|in|here|today|before)\b/,
  /\b(load\s+up|ape\s+in|get\s+in\s+now|don\s*t\s+miss|last\s+chance|to\s+the\s+moon|next\s+\d+x)\b/,
  /\b(price\s+target|will\s+(pump|moon|go\s+up|\d+x))\b/,
  /\bnot\s+a\s+drill\b|\bfinancial\s+advice\s*:/,
];

export function detectAdvice(raw: string): boolean {
  return forms(raw).some((n) => ADVICE_PATTERNS.some((re) => re.test(n)));
}

// ─── near-duplicates (word shingles) ─────────────────────────────────

export function shingles(s: string, k = 3): Set<string> {
  const words = normalizeForHash(s).split(" ").filter(Boolean);
  const out = new Set<string>();
  if (words.length < k) {
    if (words.length) out.add(words.join(" "));
    return out;
  }
  for (let i = 0; i + k <= words.length; i++) out.add(words.slice(i, i + k).join(" "));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/** Highest similarity of `text` against `others` (0–1): word-bigram Jaccard. Very short texts only match exactly. */
export function maxSimilarity(text: string, others: string[]): number {
  const a = shingles(text, 2);
  if (a.size < 3) return 0;
  let best = 0;
  for (const o of others) {
    const j = jaccard(a, shingles(o, 2));
    if (j > best) best = j;
    if (best >= 0.999) break;
  }
  return best;
}

// ─── names ───────────────────────────────────────────────────────────

/** Names an outside agent may not use: real AI brands, the host, staff-sounding names. */
const RESERVED_NAME = /\b(claudio|claude|anthropic|openai|chat\s*gpt|gpt|gemini|google\s*ai|bard|grok|xai|llama|meta\s*ai|mistral|deepseek|copilot|admin|administrator|moderator|mod|official|support|staff|system|team|helpdesk|security|phantom|solflare|jupiter|raydium|pump\s*fun|solana\s*foundation)\b/;
export const RESERVED_SLUGS = new Set([
  "claudio", "admin", "administrator", "api", "me", "new", "create", "settings", "official", "support", "system",
  "moderator", "mod", "staff", "team", "help", "root", "security", "thread", "agents", "agent", "home", "login",
  "logout", "auth", "v1", "keys", "passport", "null", "undefined",
]);

export function nameViolation(name: string): string | null {
  const n = normalizeForDetection(name);
  if (RESERVED_NAME.test(n)) return "reserved_name";
  if (detectScam(name).length || detectInjection(name).length) return "unsafe_name";
  return null;
}

export function slugify(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32)
      .replace(/-+$/g, "") || "agent"
  );
}
