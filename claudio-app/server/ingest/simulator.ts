// Realistic synthetic launches + trades for chains with no working live source.
//
// SIMULATOR=auto (default): after 15s, simulate only chains without a healthy live source; stop and purge the
//                           simulated tokens once that chain's live source is healthy for 30s.
// SIMULATOR=on:  simulate every supported chain regardless (ChainStatus.source then reads "simulated").
// SIMULATOR=off: never.
//
// Honesty: simulated tokens use obviously fake addresses — EVM `0x5153494d…` ("SIM" in ASCII hex prefix) and
// Solana base58 ending in `SiM` — and the chain's status source is "simulated" whenever the simulator runs on it.
// Socials point at search links / example.com (never at real-looking accounts).

import { CHAINS, type ChainId } from "@shared/chains";
import { LAUNCHPADS, type LaunchpadId } from "@shared/launchpads";
import type { TokenSnapshot } from "@shared/types";
import { blankToken, tokenStore } from "../store";
import { isChainLive, setSimulating, updateChainStats } from "../store/status";
import { nativeUsdOf } from "./prices";
import { ilog } from "./log";

type SimChain = "hood" | "sol" | "bsc";
const SIM_CHAINS: SimChain[] = ["hood", "sol", "bsc"];

const WEIGHTS: Record<SimChain, [LaunchpadId, number][]> = {
  hood: [["pons", 45], ["flap", 15], ["clanker", 12], ["bags", 10], ["pools", 10], ["trench", 8]],
  sol: [["pump", 70], ["bonk", 20], ["bags", 10]],
  bsc: [["four", 60], ["flap", 30], ["genius", 10]],
};

const GRAD: Partial<Record<LaunchpadId, number>> = { pons: 4.2, flap: 5, bags: 5, trench: 4, pump: 85, bonk: 85, four: 18, genius: 15 };
const GRAD_BSC_FLAP = 16;
const GRAD_SOL_BAGS = 85;
const VENUE: Partial<Record<LaunchpadId, string>> = {
  pons: "uniswap-v4", clanker: "uniswap-v4", pools: "uniswap-v4", trench: "uniswap", pump: "pumpswap",
  bonk: "raydium-cpmm", four: "pancakeswap", genius: "v4-style",
};
/** Median trade size in quote units per chain. */
const MEDIAN_SIZE: Record<SimChain, number> = { hood: 0.012, sol: 0.35, bsc: 0.06 };
/** Fallback USD prices used ONLY for simulated tokens when real prices were never fetched (offline dev). */
const FALLBACK_USD: Record<SimChain, number> = { hood: 2600, sol: 150, bsc: 700 };
const STOCKS: { sym: string; usd: number }[] = [{ sym: "NVDA", usd: 180 }, { sym: "AAPL", usd: 230 }, { sym: "HOOD", usd: 110 }];

const ADJ = ["based", "tiny", "turbo", "sleepy", "cosmic", "angry", "golden", "baby", "giga", "wet", "chad", "lucky", "moon", "degen", "shy", "frosty", "spicy", "retro", "hyper", "fat", "pixel", "zen", "wild", "royal", "silly", "dark", "neon", "lazy", "mega", "super"];
const NOUN = ["frog", "cat", "doge", "pepe", "hamster", "whale", "goblin", "penguin", "otter", "wizard", "banana", "rocket", "bear", "bull", "shrimp", "llama", "duck", "monkey", "ghost", "robot", "panda", "koala", "gecko", "crab", "tiger", "snail", "fox", "owl", "bunny", "yeti"];
const HEX = "0123456789abcdef";
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const SIM_EPOCH = Date.UTC(2026, 0, 1);

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}
function randInt(a: number, b: number): number {
  return Math.floor(rand(a, b + 1));
}
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function weighted<T>(items: [T, number][]): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [v, w] of items) {
    r -= w;
    if (r <= 0) return v;
  }
  return items[items.length - 1][0];
}
function randStr(alphabet: string, n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}
/** Log-normal-ish size around the median (heavy right tail). */
function sizeAround(median: number): number {
  const z = (Math.random() + Math.random() + Math.random() - 1.5) * 1.6;
  return median * Math.exp(z) * (Math.random() < 0.04 ? rand(4, 12) : 1);
}
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function simTokenAddress(chain: SimChain): string {
  return CHAINS[chain].kind === "evm" ? `0x5153494d${randStr(HEX, 32)}` : `${randStr(B58, 41)}SiM`;
}
function wallet(chain: SimChain): string {
  return CHAINS[chain].kind === "evm" ? `0x${randStr(HEX, 40)}` : randStr(B58, 44);
}
function txHash(chain: SimChain): string {
  return CHAINS[chain].kind === "evm" ? `0x${randStr(HEX, 64)}` : randStr(B58, 88);
}

function avatar(seed: string, symbol: string): string {
  const h = hashStr(seed);
  const h1 = h % 360;
  const h2 = (h1 + 40 + ((h >>> 9) % 140)) % 360;
  const angle = (h >>> 17) % 2 === 0 ? "x2='1' y2='1'" : "x2='0' y2='1'";
  const label = symbol.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?";
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><defs><linearGradient id='g' x1='0' y1='0' ${angle}>` +
    `<stop offset='0' stop-color='hsl(${h1},85%,58%)'/><stop offset='1' stop-color='hsl(${h2},80%,40%)'/></linearGradient></defs>` +
    `<rect width='64' height='64' rx='14' fill='url(#g)'/><text x='32' y='41' font-family='system-ui,sans-serif' font-size='24' ` +
    `font-weight='800' text-anchor='middle' fill='rgba(255,255,255,.92)'>${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

interface SimToken {
  key: string;
  chain: SimChain;
  lp: LaunchpadId;
  curve: boolean;
  supply: number;
  createdAt: number;
  creator: string;
  vQ: number;
  vT: number;
  raised: number;
  grad: number;
  hype: number;
  halfLifeMs: number;
  lastHypeAt: number;
  sizeMul: number;
  feeBps: number;
  migrated: boolean;
  devDumpAt: number;
  devDumped: boolean;
  balances: Map<string, number>;
  planned: { at: number; kind: "buy" | "sell"; wallet: string; size: number; block?: number }[];
}

interface ChainSim {
  running: boolean;
  tokens: Map<string, SimToken>;
  nextLaunchAt: number;
  liveStreak: number;
  deadStreak: number;
}

const sims = new Map<SimChain, ChainSim>();
let loopTimer: NodeJS.Timeout | undefined;

function blockOf(chain: SimChain, ts: number): number {
  return Math.floor((ts - SIM_EPOCH) / CHAINS[chain].blockTimeMs);
}

function quoteUsdFor(chain: SimChain): number | undefined {
  // Real native price when we have it; otherwise a fixed fallback so offline sims still show plausible USD.
  return nativeUsdOf(chain) > 0 ? undefined : FALLBACK_USD[chain];
}

function spawn(chain: SimChain, createdAt: number): SimToken {
  const lp = weighted(WEIGHTS[chain]);
  const info = LAUNCHPADS[lp];
  const curve = info.model === "curve";
  const adj = pick(ADJ);
  const noun = pick(NOUN);
  const name = Math.random() < 0.5 ? `${adj[0].toUpperCase()}${adj.slice(1)} ${noun[0].toUpperCase()}${noun.slice(1)}` : `${noun[0].toUpperCase()}${noun.slice(1)}${pick(["coin", "inu", " on HOOD", " 2.0", "", "", "ius", "fi"])}`.trim();
  const symbol = (Math.random() < 0.6 ? noun : `${adj.slice(0, 2)}${noun}`).toUpperCase().slice(0, randInt(3, 6));
  const address = simTokenAddress(chain);
  const supply = lp === "clanker" ? 100e9 : 1e9;
  const nu = nativeUsdOf(chain) || FALLBACK_USD[chain];

  let stock: { sym: string; usd: number } | undefined;
  if (chain === "hood" && (lp === "pons" || lp === "flap") && Math.random() < 0.12) stock = pick(STOCKS);
  const quoteScale = stock ? nu / stock.usd : 1; // quote units per 1 native unit

  let grad = GRAD[lp] ?? 5;
  if (chain === "bsc" && lp === "flap") grad = GRAD_BSC_FLAP;
  if (chain === "sol" && lp === "bags") grad = GRAD_SOL_BAGS;
  grad *= quoteScale;
  // Curve: x·y=k with pump-like shape (~79% of supply sold when `grad` quote is raised).
  // Instant pools: start ~$4–8k FDV with a deeper virtual quote side.
  const vQ = curve ? grad * 0.353 : (rand(4000, 8000) / nu) * quoteScale * 1.0;
  const vT = curve ? supply * 1.073 : supply;
  const taxed = (lp === "flap" || lp === "four") && Math.random() < 0.4;
  const tax = taxed ? pick([100, 300, 500]) : 0;
  const creator = wallet(chain);
  const hasTwitter = Math.random() < 0.45;
  const hasWeb = Math.random() < 0.2;

  const tok: SimToken = {
    key: `${chain}:${CHAINS[chain].kind === "evm" ? address.toLowerCase() : address}`,
    chain,
    lp,
    curve,
    supply,
    createdAt,
    creator,
    vQ,
    vT,
    raised: 0,
    grad,
    hype: rand(0.05, 1.2) * (Math.random() < 0.12 ? 4 : 1),
    halfLifeMs: rand(60_000, 420_000),
    lastHypeAt: createdAt,
    sizeMul: quoteScale,
    feeBps: 100,
    migrated: false,
    devDumpAt: Math.random() < 0.15 ? createdAt + rand(20_000, 240_000) : Infinity,
    devDumped: false,
    balances: new Map(),
    planned: [],
  };

  const snap: TokenSnapshot = blankToken({
    chain,
    address,
    launchpad: lp,
    name: name.slice(0, 32),
    symbol,
    creator,
    createdAt,
    createTx: txHash(chain),
    image: avatar(address, symbol),
    description: Math.random() < 0.5 ? `${name} — simulated launch for offline/dev mode.` : undefined,
    socials: {
      ...(hasTwitter ? { twitter: `https://x.com/search?q=%24${encodeURIComponent(symbol)}` } : {}),
      ...(hasWeb ? { website: `https://example.com/${symbol.toLowerCase()}` } : {}),
    },
    pool: curve ? simTokenAddress(chain) : undefined,
    quoteSymbol: stock ? stock.sym : CHAINS[chain].nativeSymbol,
    stockPaired: !!stock,
    buyTaxBps: tax,
    sellTaxBps: tax,
    priceNative: vQ / vT,
  });
  tokenStore.register(snap, {
    supply,
    simulated: true,
    trackedFromCreation: true,
    createBlock: blockOf(chain, createdAt),
    quoteUsd: stock ? stock.usd : quoteUsdFor(chain),
  });

  const med = MEDIAN_SIZE[chain] * quoteScale;
  // Dev buy (60%), snipers in the first ~3s, sometimes a same-block bundle.
  if (Math.random() < 0.6) tok.planned.push({ at: createdAt + 50, kind: "buy", wallet: creator, size: sizeAround(med * 3) });
  const snipers = Math.random() < 0.7 ? randInt(1, 6) : 0;
  for (let i = 0; i < snipers; i++) tok.planned.push({ at: createdAt + rand(150, 3000), kind: "buy", wallet: wallet(chain), size: sizeAround(med * 2) });
  if (Math.random() < 0.25) {
    const at = createdAt + rand(400, 2500);
    const block = blockOf(chain, at);
    const n = randInt(3, 6);
    for (let i = 0; i < n; i++) tok.planned.push({ at, kind: "buy", wallet: wallet(chain), size: sizeAround(med * 1.5), block });
  }
  tok.planned.sort((a, b) => a.at - b.at);
  return tok;
}

function execTrade(tok: SimToken, side: "buy" | "sell", size: number, trader: string, ts: number, block?: number): void {
  if (!(size > 0)) return;
  let amountToken: number;
  let amountNative: number;
  if (side === "buy") {
    const net = size * (1 - tok.feeBps / 10_000);
    const k = tok.vQ * tok.vT;
    const out = tok.vT - k / (tok.vQ + net);
    if (!(out > 0)) return;
    tok.vQ += net;
    tok.vT -= out;
    tok.raised += net;
    amountToken = out;
    amountNative = size;
    tok.balances.set(trader, (tok.balances.get(trader) ?? 0) + out);
  } else {
    const bal = tok.balances.get(trader) ?? 0;
    const tokens = Math.min(bal, size);
    if (!(tokens > 0)) return;
    const k = tok.vQ * tok.vT;
    const gross = tok.vQ - k / (tok.vT + tokens);
    tok.vQ -= gross;
    tok.vT += tokens;
    tok.raised = Math.max(0, tok.raised - gross);
    amountToken = tokens;
    amountNative = gross * (1 - tok.feeBps / 10_000);
    const left = bal - tokens;
    if (left > 1e-9) tok.balances.set(trader, left);
    else tok.balances.delete(trader);
  }
  const spot = tok.vQ / tok.vT;
  tokenStore.addTrade(
    {
      id: `sim:${txHash(tok.chain).slice(0, 24)}`,
      key: tok.key,
      chain: tok.chain,
      tx: txHash(tok.chain),
      block: block ?? blockOf(tok.chain, ts),
      ts,
      side,
      trader,
      amountToken,
      amountNative,
      amountUsd: 0,
      priceUsd: 0,
      mcapUsd: 0,
      tags: [],
    },
    {
      spotPriceNative: spot,
      bondingPct: tok.curve && !tok.migrated ? Math.min(100, (tok.raised / tok.grad) * 100) : undefined,
      liquidityNative: tok.curve && !tok.migrated ? tok.raised : 2 * tok.vQ,
    },
  );
  if (tok.curve && !tok.migrated && tok.raised >= tok.grad) {
    tok.migrated = true;
    tok.hype *= 0.6;
    const venue = tok.lp === "flap" ? (tok.chain === "bsc" ? "pancakeswap" : "uniswap-v2") : tok.lp === "bags" ? (tok.chain === "sol" ? "meteora-damm-v2" : "uniswap-v4") : VENUE[tok.lp];
    tokenStore.migrate(tok.key, { venue, at: ts });
  }
}

function organicStep(tok: SimToken, now: number, dtMs: number): void {
  // Hype decays with a per-token half-life; rare revivals.
  const dt = now - tok.lastHypeAt;
  tok.lastHypeAt = now;
  tok.hype *= Math.pow(0.5, dt / tok.halfLifeMs);
  if (Math.random() < 0.0015) tok.hype += rand(0.3, 2);

  const lambda = tok.hype * (dtMs / 1000);
  let n = 0;
  let p = Math.exp(-lambda);
  let cum = p;
  const u = Math.random();
  while (u > cum && n < 8) {
    n++;
    p *= lambda / n;
    cum += p;
  }
  const med = MEDIAN_SIZE[tok.chain] * tok.sizeMul;
  for (let i = 0; i < n; i++) {
    const holders = [...tok.balances.keys()];
    const sellBias = tok.hype < 0.15 ? 0.6 : 0.4;
    if (holders.length && Math.random() < sellBias) {
      const w = pick(holders);
      const bal = tok.balances.get(w) ?? 0;
      execTrade(tok, "sell", bal * (Math.random() < 0.5 ? 1 : rand(0.2, 0.8)), w, now);
    } else {
      const w = holders.length > 3 && Math.random() < 0.25 ? pick(holders) : wallet(tok.chain);
      execTrade(tok, "buy", sizeAround(med), w, now);
    }
  }
}

function stepChain(chain: SimChain, sim: ChainSim, now: number, dtMs: number): void {
  if (now >= sim.nextLaunchAt) {
    const tok = spawn(chain, now);
    sim.tokens.set(tok.key, tok);
    sim.nextLaunchAt = now + rand(1000, 6000);
  }
  for (const [key, tok] of sim.tokens) {
    if (!tokenStore.has(key)) {
      sim.tokens.delete(key); // evicted
      continue;
    }
    while (tok.planned.length && tok.planned[0].at <= now) {
      const p = tok.planned.shift();
      if (p) execTrade(tok, p.kind, p.size, p.wallet, Math.max(p.at, tok.createdAt), p.block);
    }
    if (!tok.devDumped && now >= tok.devDumpAt) {
      tok.devDumped = true;
      const bal = tok.balances.get(tok.creator) ?? 0;
      if (bal > 0) execTrade(tok, "sell", bal, tok.creator, now);
      tok.hype *= 0.3;
    }
    organicStep(tok, now, dtMs);
    if (now - tok.createdAt > 15 * 60_000 && tok.hype < 0.01) sim.tokens.delete(key); // stays on the board, stops trading
  }
  if (sim.tokens.size > 180) {
    const sorted = [...sim.tokens.values()].sort((a, b) => a.hype - b.hype);
    for (const t of sorted.slice(0, sim.tokens.size - 180)) sim.tokens.delete(t.key);
  }
  updateChainStats(chain, { lastBlock: blockOf(chain, now), latencyMs: 0, lastEventAt: now, gas: "sim" });
}

/** Seed a board with history so all three columns have content right away. */
function seed(chain: SimChain, sim: ChainSim): void {
  const now = Date.now();
  for (let i = 0; i < 36; i++) {
    const createdAt = now - rand(30_000, 40 * 60_000);
    const tok = spawn(chain, createdAt);
    // Fast-forward: a burst of history trades spaced over the token's life.
    const target = Math.random();
    const steps = randInt(10, 70);
    const span = now - createdAt;
    for (let s = 0; s < steps; s++) {
      const ts = createdAt + (span * (s + 1)) / (steps + 1);
      while (tok.planned.length && tok.planned[0].at <= ts) {
        const p = tok.planned.shift();
        if (p) execTrade(tok, p.kind, p.size, p.wallet, p.at, p.block);
      }
      const holders = [...tok.balances.keys()];
      const wantProgress = tok.curve ? tok.raised / tok.grad < target * 1.25 : Math.random() < 0.6;
      if (holders.length && (!wantProgress || Math.random() < 0.3)) {
        const w = pick(holders);
        execTrade(tok, "sell", (tok.balances.get(w) ?? 0) * rand(0.3, 1), w, ts);
      } else {
        // Curve: size buys so the token ends near `target` of its graduation (some overshoot → migrated).
        const base = MEDIAN_SIZE[chain] * tok.sizeMul;
        const med = tok.curve ? Math.max(base, (tok.grad * target * 1.6) / steps) : base * 1.5;
        execTrade(tok, "buy", sizeAround(med), wallet(chain), ts);
      }
    }
    tok.planned = [];
    tok.lastHypeAt = now;
    tok.hype *= 0.5;
    sim.tokens.set(tok.key, tok);
  }
}

function startChain(chain: SimChain): void {
  let sim = sims.get(chain);
  if (!sim) {
    sim = { running: false, tokens: new Map(), nextLaunchAt: 0, liveStreak: 0, deadStreak: 0 };
    sims.set(chain, sim);
  }
  if (sim.running) return;
  sim.running = true;
  sim.nextLaunchAt = Date.now() + 500;
  setSimulating(chain, true);
  ilog("simulator", `simulating ${CHAINS[chain].name} (source: simulated)`);
  try {
    seed(chain, sim);
  } catch (e) {
    ilog("simulator", `seed failed: ${(e as Error).message}`);
  }
  ensureLoop();
}

function stopChain(chain: SimChain, purge: boolean): void {
  const sim = sims.get(chain);
  if (!sim?.running) return;
  sim.running = false;
  sim.tokens.clear();
  setSimulating(chain, false);
  const n = purge ? tokenStore.purge((t) => t.chain === chain && tokenStore.isSimulated(t.key)) : 0;
  ilog("simulator", `stopped ${CHAINS[chain].name}${purge ? `, purged ${n} simulated tokens` : ""}`);
}

function ensureLoop(): void {
  if (loopTimer) return;
  let last = Date.now();
  loopTimer = setInterval(() => {
    const now = Date.now();
    const dt = Math.min(2000, now - last);
    last = now;
    for (const [chain, sim] of sims) {
      if (!sim.running) continue;
      try {
        stepChain(chain, sim, now, dt);
      } catch (e) {
        ilog("simulator", `${chain} step failed: ${(e as Error).message}`);
      }
    }
  }, 250);
  loopTimer.unref();
}

export type SimMode = "auto" | "on" | "off";

export function simulatorMode(): SimMode {
  const v = (process.env.SIMULATOR ?? "auto").toLowerCase();
  return v === "on" || v === "off" ? v : "auto";
}

export function startSimulator(mode: SimMode = simulatorMode(), chains: ChainId[] = SIM_CHAINS): void {
  const targets = SIM_CHAINS.filter((c) => chains.includes(c) && CHAINS[c].enabled);
  if (mode === "off") {
    ilog("simulator", "off (SIMULATOR=off)");
    return;
  }
  if (mode === "on") {
    for (const c of targets) startChain(c);
    return;
  }
  // auto
  const startedOnce = new Set<SimChain>();
  const check = (): void => {
    for (const c of targets) {
      let sim = sims.get(c);
      if (!sim) {
        sim = { running: false, tokens: new Map(), nextLaunchAt: 0, liveStreak: 0, deadStreak: 0 };
        sims.set(c, sim);
      }
      const live = isChainLive(c);
      sim.liveStreak = live ? sim.liveStreak + 1 : 0;
      sim.deadStreak = live ? 0 : sim.deadStreak + 1;
      if (sim.running && sim.liveStreak >= 2) stopChain(c, true);
      // First check (15s after boot) starts immediately; later restarts need 60s without a live source.
      else if (!sim.running && !live && (sim.deadStreak >= 4 || !startedOnce.has(c))) {
        startedOnce.add(c);
        startChain(c);
      } else if (live) startedOnce.add(c);
    }
  };
  setTimeout(() => {
    check();
    setInterval(check, 15_000).unref();
  }, 15_000).unref();
}
