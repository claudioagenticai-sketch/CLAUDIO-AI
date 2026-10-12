// Candles + volume from our own indexed trades (lightweight-charts v4 API).
// - Resolutions 15s/1m/5m/15m/1h → GET /api/candles/:key?res=<sec> (Candle[] in USD price)
// - Live: the last candle is updated from incoming trades; new buckets are appended.
// - Price / MCap toggle (MCap = price × supply implied by the snapshot).
// - Markers: dev buys/sells, snipers, and your own trades.

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import {
  ColorType,
  CrosshairMode,
  createChart,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle, TokenSnapshot, Trade } from "@shared/types";
import { deploymentOf } from "@shared/launchpads";
import type { HistoryTrade } from "@/lib/history";
import { fmtCompact, fmtPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

const RESOLUTIONS = [
  { label: "15s", sec: 15 },
  { label: "1m", sec: 60 },
  { label: "5m", sec: 300 },
  { label: "15m", sec: 900 },
  { label: "1h", sec: 3600 },
] as const;

type Mode = "price" | "mcap";
const RES_STORE = "claudio.chart.res";
const MODE_STORE = "claudio.chart.mode";

function readPref<T extends string | number>(k: string, fallback: T, valid: (v: string) => boolean): T {
  try {
    const v = localStorage.getItem(k);
    if (v !== null && valid(v)) return (typeof fallback === "number" ? Number(v) : v) as T;
  } catch {
    /* storage unavailable */
  }
  return fallback;
}
function writePref(k: string, v: string | number) {
  try {
    localStorage.setItem(k, String(v));
  } catch {
    /* ignore */
  }
}

function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** lightweight-charts renders UTC; shift so the axis reads local time. */
const TZ_SHIFT_SEC = -new Date().getTimezoneOffset() * 60;
const toTime = (sec: number) => (sec + TZ_SHIFT_SEC) as UTCTimestamp;

function bucketOf(tsMs: number, res: number): number {
  return Math.floor(tsMs / 1000 / res) * res;
}

/** Fallback when the server has no candles yet: bucket our trade tape. */
function candlesFromTrades(trades: Trade[], res: number): Candle[] {
  const asc = [...trades].filter((t) => t.priceUsd > 0).sort((a, b) => a.ts - b.ts);
  const out: Candle[] = [];
  for (const t of asc) {
    const b = bucketOf(t.ts, res);
    const last = out[out.length - 1];
    if (last && last.t === b) {
      last.h = Math.max(last.h, t.priceUsd);
      last.l = Math.min(last.l, t.priceUsd);
      last.c = t.priceUsd;
      last.v += t.amountUsd;
    } else {
      const o = last ? last.c : t.priceUsd;
      out.push({ t: b, o, h: Math.max(o, t.priceUsd), l: Math.min(o, t.priceUsd), c: t.priceUsd, v: t.amountUsd });
    }
  }
  return out;
}

async function fetchCandles(key: string, res: number): Promise<Candle[]> {
  const r = await fetch(`/api/candles/${encodeURIComponent(key)}?res=${res}`, { credentials: "include" });
  if (!r.ok) throw new Error(`candles ${r.status}`);
  const data = (await r.json()) as Candle[];
  return Array.isArray(data) ? data : [];
}

interface Legend {
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface ChartProps {
  token: TokenSnapshot;
  trades: Trade[];
  myTrades: HistoryTrade[];
  className?: string;
  /** CSS height of the plot area, e.g. "45vh" or 420. */
  height: string | number;
}

export default function Chart({ token, trades, myTrades, className, height }: ChartProps) {
  const [res, setRes] = useState<number>(() => readPref<number>(RES_STORE, 15, (v) => RESOLUTIONS.some((r) => String(r.sec) === v)));
  const [mode, setMode] = useState<Mode>(() => readPref<Mode>(MODE_STORE, "mcap", (v) => v === "price" || v === "mcap"));
  const [legend, setLegend] = useState<Legend | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  /** Working copy of candles in raw USD price units (live-updated). */
  const barsRef = useRef<Candle[]>([]);
  const lastTradeTsRef = useRef<number>(0);
  const fittedRef = useRef<string>("");
  const colorsRef = useRef({ up: "#3ddc97", down: "#f4506f", upVol: "rgba(61,220,151,0.35)", downVol: "rgba(244,80,111,0.35)" });

  const { data: serverCandles, isLoading } = useQuery<Candle[]>({
    queryKey: ["candles", token.key, res],
    queryFn: () => fetchCandles(token.key, res),
    refetchInterval: 60_000,
    retry: 1,
  });

  // Price → MCap multiplier (supply). Prefer the live ratio; fall back to the launchpad's total supply.
  const supply = useMemo(() => {
    if (token.priceUsd > 0 && token.mcapUsd > 0) return token.mcapUsd / token.priceUsd;
    return deploymentOf(token.launchpad, token.chain)?.totalSupply ?? 1e9;
  }, [token.priceUsd, token.mcapUsd, token.launchpad, token.chain]);
  // Round supply so tiny ratio jitter doesn't re-render the whole series.
  const factor = mode === "mcap" ? Number(supply.toPrecision(6)) : 1;
  const factorRef = useRef(factor);
  factorRef.current = factor;

  // ── create chart once ──
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const text2 = cssVar("--text-3", "#8b96ae");
    const line = cssVar("--line", "#222e47");
    const panel = cssVar("--bg-elev", "#0e141e");
    const up = cssVar("--buy", "#3ddc97");
    const down = cssVar("--sell", "#f4506f");
    colorsRef.current = { up, down, upVol: hexA(up, 0.35), downVol: hexA(down, 0.35) };

    const chart = createChart(el, {
      width: el.clientWidth,
      height: el.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: panel },
        textColor: text2,
        fontFamily: cssVar("--font-mono", "ui-monospace, monospace"),
        fontSize: 11,
      },
      grid: { vertLines: { color: hexA(line, 0.5) }, horzLines: { color: hexA(line, 0.5) } },
      rightPriceScale: { borderColor: line, scaleMargins: { top: 0.1, bottom: 0.24 } },
      // fixLeftEdge: the first candle can't be dragged right into empty space (panning back through history still works).
      // No fixRightEdge — it would fight the small rightOffset that keeps the live candle off the price scale.
      timeScale: {
        borderColor: line,
        timeVisible: true,
        secondsVisible: true,
        rightOffset: 3,
        barSpacing: 7,
        fixLeftEdge: true,
        lockVisibleTimeRangeOnResize: true,
      },
      crosshair: { mode: CrosshairMode.Normal },
      handleScroll: { vertTouchDrag: false, mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true },
    });
    const candles = chart.addCandlestickSeries({
      upColor: up,
      downColor: down,
      wickUpColor: up,
      wickDownColor: down,
      borderVisible: false,
      priceLineVisible: true,
      priceFormat: { type: "custom", minMove: 1e-12, formatter: (p: number) => formatAxis(p, factorRef.current !== 1) },
    });
    const vol = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "", lastValueVisible: false, priceLineVisible: false });
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

    const onMove = (p: MouseEventParams<Time>) => {
      const d = p.seriesData.get(candles) as CandlestickData<Time> | undefined;
      if (d && typeof d.open === "number") setLegend({ o: d.open, h: d.high, l: d.low, c: d.close });
      else setLegend(null);
    };
    chart.subscribeCrosshairMove(onMove);

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);

    chartRef.current = chart;
    candleRef.current = candles;
    volRef.current = vol;
    return () => {
      ro.disconnect();
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volRef.current = null;
    };
  }, []);

  // ── (re)load bars when the resolution / data / mode changes ──
  useEffect(() => {
    const candles = candleRef.current;
    const vol = volRef.current;
    if (!candles || !vol) return;
    const fromServer = !!(serverCandles && serverCandles.length);
    const base = fromServer ? (serverCandles as Candle[]).map((c) => ({ ...c })) : candlesFromTrades(trades, res);
    barsRef.current = base;
    // Trades already reflected in `base` must not be applied again. Server candles include everything up to ~now.
    const newest = trades.length ? trades[0].ts : 0;
    lastTradeTsRef.current = fromServer ? Math.max(newest, Date.now() - 1_500) : newest;
    const { up, down, upVol, downVol } = colorsRef.current;
    candles.setData(base.map((c) => toBar(c, factor)));
    vol.setData(base.map<HistogramData<Time>>((c) => ({ time: toTime(c.t), value: c.v, color: c.c >= c.o ? upVol : downVol })));
    candles.applyOptions({ upColor: up, downColor: down });
    const fitKey = `${token.key}:${res}`;
    if (fittedRef.current !== fitKey && base.length) {
      fittedRef.current = fitKey;
      if (base.length > 120) chartRef.current?.timeScale().setVisibleLogicalRange({ from: base.length - 120, to: base.length + 3 });
      else chartRef.current?.timeScale().fitContent();
    }
    // trades are intentionally not a dependency: live trades are applied incrementally below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverCandles, res, factor, token.key]);

  // ── live trades → update / append the last bar ──
  useEffect(() => {
    const candles = candleRef.current;
    const vol = volRef.current;
    if (!candles || !vol || !trades.length) return;
    const fresh = trades.filter((t) => t.ts > lastTradeTsRef.current && t.priceUsd > 0).reverse(); // oldest first
    if (!fresh.length) return;
    lastTradeTsRef.current = trades[0].ts;
    const { upVol, downVol } = colorsRef.current;
    const bars = barsRef.current;
    for (const t of fresh) {
      const b = bucketOf(t.ts, res);
      const last = bars[bars.length - 1];
      let bar: Candle;
      if (last && b < last.t) continue; // older than what's drawn; server candles already include it
      if (last && last.t === b) {
        last.h = Math.max(last.h, t.priceUsd);
        last.l = Math.min(last.l, t.priceUsd);
        last.c = t.priceUsd;
        last.v += t.amountUsd;
        bar = last;
      } else {
        const o = last ? last.c : t.priceUsd;
        bar = { t: b, o, h: Math.max(o, t.priceUsd), l: Math.min(o, t.priceUsd), c: t.priceUsd, v: t.amountUsd };
        bars.push(bar);
      }
      candles.update(toBar(bar, factorRef.current));
      vol.update({ time: toTime(bar.t), value: bar.v, color: bar.c >= bar.o ? upVol : downVol });
    }
  }, [trades, res]);

  // ── markers: dev / sniper / you ──
  useEffect(() => {
    const candles = candleRef.current;
    if (!candles) return;
    const times = new Set(barsRef.current.map((b) => b.t));
    const { up, down } = colorsRef.current;
    const gold = cssVar("--gold", "#ffd166");
    const brandColor = cssVar("--brand", "#e08a6c");
    const seen = new Set<string>();
    const markers: SeriesMarker<Time>[] = [];
    const add = (tsMs: number, side: "buy" | "sell", kind: "dev" | "sniper" | "you") => {
      const b = bucketOf(tsMs, res);
      if (!times.has(b)) return;
      const id = `${b}:${side}:${kind}`;
      if (seen.has(id)) return;
      seen.add(id);
      const color = kind === "you" ? brandColor : kind === "dev" ? gold : side === "buy" ? up : down;
      markers.push({
        time: toTime(b),
        position: side === "buy" ? "belowBar" : "aboveBar",
        color,
        shape: kind === "sniper" ? "circle" : side === "buy" ? "arrowUp" : "arrowDown",
        text: kind === "you" ? (side === "buy" ? "You B" : "You S") : kind === "dev" ? (side === "buy" ? "Dev B" : "Dev S") : "Snp",
        size: kind === "sniper" ? 0.6 : 1,
      });
    };
    for (const t of trades) {
      if (t.tags.includes("you")) add(t.ts, t.side, "you");
      else if (t.tags.includes("dev")) add(t.ts, t.side, "dev");
      else if (t.tags.includes("sniper") && t.side === "buy") add(t.ts, t.side, "sniper");
    }
    for (const m of myTrades) if (m.status !== "failed") add(m.ts, m.side, "you");
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    candles.setMarkers(markers.slice(-250));
  }, [trades, myTrades, res, serverCandles, factor]);

  const empty = !isLoading && !(serverCandles && serverCandles.length) && trades.length === 0;
  const last = barsRef.current[barsRef.current.length - 1];
  const shown: Legend | null = legend ?? (last ? { o: last.o * factor, h: last.h * factor, l: last.l * factor, c: last.c * factor } : null);

  const legendNode = shown ? <OhlcLegend v={shown} mcap={mode === "mcap"} /> : null;

  return (
    <div className={cn("panel relative flex flex-col overflow-hidden", className)}>
      <div className="flex min-h-[48px] flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-2.5 py-2">
        <SegmentedPills
          id="res"
          value={String(res)}
          onChange={(v) => {
            const sec = Number(v);
            setRes(sec);
            writePref(RES_STORE, sec);
          }}
          items={RESOLUTIONS.map((r) => ({ id: String(r.sec), label: r.label }))}
          mono
          label="Resolution"
        />
        <div className="hidden min-w-0 flex-1 md:block">{legendNode}</div>
        <SegmentedPills
          id="mode"
          className="ml-auto md:ml-0"
          value={mode}
          onChange={(v) => {
            const m = v as Mode;
            setMode(m);
            writePref(MODE_STORE, m);
          }}
          items={[
            { id: "price", label: "Price" },
            { id: "mcap", label: "MCap" },
          ]}
          label="Chart value"
        />
      </div>

      <div className="relative" style={{ height }}>
        <div ref={wrapRef} className="absolute inset-0" />
        {legendNode && <div className="pointer-events-none absolute left-2.5 right-[72px] top-2 z-[2] md:hidden">{legendNode}</div>}
        {isLoading && <div className="sheen pointer-events-none absolute inset-0 z-[1]" />}
        {empty && (
          <div className="pointer-events-none absolute inset-0 z-[1] flex flex-col items-center justify-center gap-2 text-xs text-text-3">
            Waiting for the first trade…
          </div>
        )}
      </div>
    </div>
  );
}

/** Pill group with a sliding selection (resolution, Price / MCap). */
function SegmentedPills({
  id,
  items,
  value,
  onChange,
  mono = false,
  label,
  className,
}: {
  id: string;
  items: { id: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
  label: string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <div className={cn("no-scrollbar flex shrink-0 items-center overflow-x-auto rounded-[3px] p-0.5 ring-1 ring-inset ring-line-2", className)} aria-label={label}>
      {items.map((it) => {
        const on = it.id === value;
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => onChange(it.id)}
            aria-pressed={on}
            className={cn(
              "relative h-7 min-w-[34px] rounded-[2px] px-2.5 text-[11.5px] font-medium transition-colors",
              mono && "num",
              on ? "text-text" : "text-text-3 hover:text-text-2",
            )}
          >
            {on && (
              <motion.span
                layoutId={`chart-${id}-pill`}
                transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 40 }}
                className="absolute inset-0 rounded-[2px] bg-panel-3"
              />
            )}
            <span className="relative">{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function OhlcLegend({ v, mcap }: { v: Legend; mcap: boolean }) {
  const up = v.c >= v.o;
  const chg = v.o > 0 ? ((v.c - v.o) / v.o) * 100 : 0;
  const cell = (k: string, n: number, cls = "text-text-2") => (
    <span className="whitespace-nowrap">
      <span className="text-text-3">{k}</span> <span className={cls}>{formatAxis(n, mcap)}</span>
    </span>
  );
  return (
    <div className="num flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10.5px]">
      {cell("O", v.o)}
      {cell("H", v.h)}
      {cell("L", v.l)}
      {cell("C", v.c, up ? "text-buy" : "text-sell")}
      <span className={cn("whitespace-nowrap", up ? "text-buy" : "text-sell")}>
        {chg >= 0 ? "+" : ""}
        {chg.toFixed(2)}%
      </span>
    </div>
  );
}

function toBar(c: Candle, factor: number): CandlestickData<Time> {
  return { time: toTime(c.t), open: c.o * factor, high: c.h * factor, low: c.l * factor, close: c.c * factor };
}

function formatAxis(v: number, mcap: boolean): string {
  return mcap ? `$${fmtCompact(v, 2)}` : `$${fmtPrice(v)}`;
}

/** "#rrggbb" + alpha → rgba(); passes other color formats through unchanged. */
function hexA(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
