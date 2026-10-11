// Chain + launchpad switches (tables chain_status / launchpad_status, migration 100). What actually applies is the
// STRICTER of the admin's state and what the code can do:
//   chain     effective = admin state, but a chain disabled in shared/chains is always coming_soon;
//   launchpad effective = hidden if the admin hid it; otherwise open only when the admin opened it AND the adapter is
//             beta/live for that chain AND the chain is open — else coming_soon.
// Without DATABASE_URL the same defaults live in memory (admin edits then last until restart). Cached 15 s.
import { CHAINS, CHAIN_ORDER, type ChainId } from "@shared/chains";
import { LAUNCHPADS, LAUNCHPAD_ORDER, deploymentOf, type LaunchpadId } from "@shared/launchpads";
import type { AdminChainRow, AdminLaunchpadRow, ChainSwitchState, SwitchState } from "@shared/platform";
import { pool } from "../db";
import { ADAPTERS } from "../launch/registry";
import { LaunchError } from "../launch/types";

export const CHAIN_STATES: ChainSwitchState[] = ["open", "view_only", "coming_soon"];
export const LAUNCHPAD_STATES: SwitchState[] = ["open", "coming_soon", "hidden"];

interface ChainRow {
  chain: ChainId;
  state: ChainSwitchState;
  note: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}
interface PadRow {
  launchpad: LaunchpadId;
  chain: ChainId;
  state: SwitchState;
  allowAgents: boolean;
  note: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

// ─── Defaults (identical to the 100_platform.sql seeds) ──────────────

export function defaultChainRow(chain: ChainId): ChainRow {
  const open = chain === "sol";
  return { chain, state: open ? "open" : "coming_soon", note: open ? null : `${CHAINS[chain].name} launches are coming soon`, updatedBy: null, updatedAt: null };
}

export function defaultPadRow(launchpad: LaunchpadId, chain: ChainId): PadRow {
  const open = launchpad === "pump" && chain === "sol";
  const hidden = launchpad === "stonkfun";
  return {
    launchpad,
    chain,
    state: open ? "open" : hidden ? "hidden" : "coming_soon",
    allowAgents: open,
    note: open ? null : hidden ? "Custodial fee forwarding: the creator/platform split can't be locked" : "Coming soon",
    updatedBy: null,
    updatedAt: null,
  };
}

/** Every (launchpad, chain) deployment in the registry. */
export function deploymentPairs(): { launchpad: LaunchpadId; chain: ChainId }[] {
  return LAUNCHPAD_ORDER.flatMap((launchpad) => LAUNCHPADS[launchpad].deployments.map((d) => ({ launchpad, chain: d.chain })));
}

// ─── Storage ─────────────────────────────────────────────────────────

const memChains = new Map<ChainId, ChainRow>();
const memPads = new Map<string, PadRow>();
const padKey = (lp: string, chain: string) => `${lp}:${chain}`;

let cache: { at: number; chains: Map<ChainId, ChainRow>; pads: Map<string, PadRow> } | null = null;
const TTL_MS = 15_000;

const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

async function load(): Promise<{ chains: Map<ChainId, ChainRow>; pads: Map<string, PadRow> }> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache;
  const chains = new Map<ChainId, ChainRow>();
  const pads = new Map<string, PadRow>();
  for (const c of CHAIN_ORDER) chains.set(c, memChains.get(c) ?? defaultChainRow(c));
  for (const p of deploymentPairs()) pads.set(padKey(p.launchpad, p.chain), memPads.get(padKey(p.launchpad, p.chain)) ?? defaultPadRow(p.launchpad, p.chain));
  if (pool) {
    try {
      const [c, l] = await Promise.all([
        pool.query(`SELECT chain, state, note, updated_by, updated_at FROM chain_status`),
        pool.query(`SELECT launchpad, chain, state, allow_agents, note, updated_by, updated_at FROM launchpad_status`),
      ]);
      for (const r of c.rows) {
        if (!chains.has(r.chain) || !CHAIN_STATES.includes(r.state)) continue;
        chains.set(r.chain, { chain: r.chain, state: r.state, note: r.note, updatedBy: r.updated_by, updatedAt: iso(r.updated_at) });
      }
      for (const r of l.rows) {
        const k = padKey(r.launchpad, r.chain);
        if (!pads.has(k) || !LAUNCHPAD_STATES.includes(r.state)) continue;
        pads.set(k, { launchpad: r.launchpad, chain: r.chain, state: r.state, allowAgents: !!r.allow_agents, note: r.note, updatedBy: r.updated_by, updatedAt: iso(r.updated_at) });
      }
    } catch (e) {
      // Tables missing (migration failed) → defaults, but don't cache the failure for long.
      console.warn("[platform] switches load failed:", (e as Error).message);
      cache = { at: Date.now() - TTL_MS + 3_000, chains, pads };
      return cache;
    }
  }
  cache = { at: Date.now(), chains, pads };
  return cache;
}

export function invalidateSwitches(): void {
  cache = null;
}

// ─── Effective state ─────────────────────────────────────────────────

function chainEffective(row: ChainRow): { effective: ChainSwitchState; reason: string | null } {
  if (!CHAINS[row.chain].enabled) return { effective: "coming_soon", reason: `${CHAINS[row.chain].name} is disabled in this build` };
  return { effective: row.state, reason: null };
}

/** Can the code launch on this launchpad/chain at all? */
export function padCapability(launchpad: LaunchpadId, chain: ChainId): { capable: boolean; adapter: AdminLaunchpadRow["adapter"]; reason: string | null } {
  const a = ADAPTERS[launchpad];
  const adapter = a.status;
  if (!deploymentOf(launchpad, chain)) return { capable: false, adapter, reason: `${LAUNCHPADS[launchpad].name} isn't deployed on ${CHAINS[chain].name}` };
  if (adapter !== "live" && adapter !== "beta") return { capable: false, adapter, reason: `${LAUNCHPADS[launchpad].name} launches aren't built yet (${adapter})` };
  if (!a.chains.includes(chain)) return { capable: false, adapter, reason: `${LAUNCHPADS[launchpad].name} launches on ${CHAINS[chain].name} aren't built yet` };
  return { capable: true, adapter, reason: null };
}

function padEffective(row: PadRow, chain: ChainRow): { effective: SwitchState; capable: boolean; adapter: AdminLaunchpadRow["adapter"]; reason: string | null } {
  const cap = padCapability(row.launchpad, row.chain);
  if (row.state === "hidden") return { effective: "hidden", ...cap };
  if (row.state !== "open") return { effective: row.state, ...cap };
  if (!cap.capable) return { effective: "coming_soon", ...cap };
  const ce = chainEffective(chain);
  if (ce.effective !== "open") return { effective: "coming_soon", ...cap, reason: ce.reason ?? `${CHAINS[row.chain].name} is ${ce.effective.replace("_", " ")}` };
  return { effective: "open", ...cap };
}

export async function chainRows(): Promise<AdminChainRow[]> {
  const { chains } = await load();
  return CHAIN_ORDER.map((c) => {
    const row = chains.get(c)!;
    return { chain: c, state: row.state, effective: chainEffective(row).effective, note: row.note, updatedBy: row.updatedBy, updatedAt: row.updatedAt };
  });
}

export async function launchpadRows(): Promise<AdminLaunchpadRow[]> {
  const { chains, pads } = await load();
  return deploymentPairs().map(({ launchpad, chain }) => {
    const row = pads.get(padKey(launchpad, chain))!;
    const eff = padEffective(row, chains.get(chain)!);
    return {
      launchpad,
      chain,
      state: row.state,
      effective: eff.effective,
      allowAgents: row.allowAgents && eff.effective === "open",
      note: row.note,
      adapter: eff.adapter,
      capable: eff.capable,
      reason: eff.effective !== row.state ? eff.reason : null,
      updatedBy: row.updatedBy,
      updatedAt: row.updatedAt,
    };
  });
}

/**
 * Throws 403 launchpad_closed unless `launchpad` on `chain` is effectively open (and, for agent launches, allows
 * agents). The admin's note is part of the message.
 */
export async function assertLaunchOpen(launchpad: LaunchpadId, chain: ChainId, opts: { agent?: boolean } = {}): Promise<void> {
  const rows = await launchpadRows();
  const row = rows.find((r) => r.launchpad === launchpad && r.chain === chain);
  const name = `${LAUNCHPADS[launchpad].name} on ${CHAINS[chain].name}`;
  if (!row || row.effective !== "open") {
    const chainRow = (await chainRows()).find((c) => c.chain === chain);
    const note = row?.note || (chainRow && chainRow.effective !== "open" ? chainRow.note : null) || row?.reason;
    throw new LaunchError(403, "launchpad_closed", `${name} isn't open for launches${row?.effective === "hidden" ? "" : " yet"}${note ? ` — ${note}` : ""}`);
  }
  if (opts.agent && !row.allowAgents) {
    throw new LaunchError(403, "launchpad_closed", `Agents can't launch on ${name} yet${row.note ? ` — ${row.note}` : ""}`);
  }
}

// ─── Admin edits ─────────────────────────────────────────────────────

export async function setChainState(chain: ChainId, state: ChainSwitchState, note: string | null, actor: string): Promise<void> {
  const row: ChainRow = { chain, state, note, updatedBy: actor, updatedAt: new Date().toISOString() };
  memChains.set(chain, row);
  if (pool) {
    await pool.query(
      `INSERT INTO chain_status (chain, state, note, updated_by, updated_at) VALUES ($1,$2,$3,$4,now())
       ON CONFLICT (chain) DO UPDATE SET state = EXCLUDED.state, note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [chain, state, note, actor],
    );
  }
  invalidateSwitches();
}

export async function setLaunchpadState(
  launchpad: LaunchpadId,
  chain: ChainId,
  state: SwitchState,
  allowAgents: boolean,
  note: string | null,
  actor: string,
): Promise<void> {
  const row: PadRow = { launchpad, chain, state, allowAgents, note, updatedBy: actor, updatedAt: new Date().toISOString() };
  memPads.set(padKey(launchpad, chain), row);
  if (pool) {
    await pool.query(
      `INSERT INTO launchpad_status (launchpad, chain, state, allow_agents, note, updated_by, updated_at) VALUES ($1,$2,$3,$4,$5,$6,now())
       ON CONFLICT (launchpad, chain) DO UPDATE SET state = EXCLUDED.state, allow_agents = EXCLUDED.allow_agents, note = EXCLUDED.note,
         updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [launchpad, chain, state, allowAgents, note, actor],
    );
  }
  invalidateSwitches();
}

/** Test hook: forget in-memory overrides. */
export function resetSwitchMemory(): void {
  memChains.clear();
  memPads.clear();
  invalidateSwitches();
}
