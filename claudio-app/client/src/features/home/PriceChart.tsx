// $CLAUDIO's small live price chart for Home: a baseline line from /api/candles (green above where the range
// opened, red below), 1H · 6H · 24H, polled every 30 s. Hover shows the price at that moment.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ColorType, CrosshairMode, LineStyle, createChart, type IChartApi, type ISeriesApi, type MouseEventParams, type Time, type UTCTimestamp } from "lightweight-charts";
import type { Candle } from "@shared/types";
import { fmtPct, fmtPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

type Range = "1h" | "6h" | "24h";
const RANGES: { id: Range; label: string; res: number; limit: number }[] = [
  { id: "1h", label: "1H", res: 60, limit: 60 },
  { id: "6h", label: "6H", res: 300, limit: 72 },
  { id: "24h", label: "24H", res: 900, limit: 96 },
];

function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function alpha(hex: string, a: number): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return hex;
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** lightweight-charts renders UTC; shift so the axis reads local time. */
const TZ_SHIFT_SEC = -new Date().getTimezoneOffset() * 60;

export function useCandles(key: string, res: number, limit: number) {
  return useQuery<Candle[]>({
    queryKey: ["home-candles", key, res, limit],
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: false,
    queryFn: async () => {
      const r = await fetch(`/api/candles/${encodeURIComponent(key)}?res=${res}&limit=${limit}`, { credentials: "include" });
      if (!r.ok || !(r.headers.get("content-type") ?? "").includes("json")) return [];
      const rows = (await r.json()) as Candle[];
      return Array.isArray(rows) ? rows.filter((c) => c && c.c > 0 && Number.isFinite(c.t)).sort((a, b) => a.t - b.t) : [];
    },
  });
}

/** `height` in px; 0 = fill the parent (which must be a flex column with a definite height). `fullHref` adds a "Full chart" link. */
export function PriceChart({ tokenKey, className, height = 168, fullHref }: { tokenKey: string; className?: string; height?: number; fullHref?: string }) {
  const [range, setRange] = useState<Range>("6h");
  const spec = RANGES.find((r) => r.id === range)!;
  const q = useCandles(tokenKey, spec.res, spec.limit);
  const candles = q.data ?? [];
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Baseline"> | null>(null);
  const [hover, setHover] = useState<{ price: number; t: number } | null>(null);

  const first = candles[0]?.o ?? candles[0]?.c;
  const last = candles[candles.length - 1]?.c;
  const change = first && last ? ((last - first) / first) * 100 : null;
  const spanMin = candles.length > 1 ? Math.round((candles[candles.length - 1].t - candles[0].t) / 60) + spec.res / 60 : 0;

  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const text3 = cssVar("--text-3", "#a48b96");
    const line = cssVar("--line", "#34222e");
    const panel = cssVar("--bg-elev", "#0d0e11");
    const up = cssVar("--buy", "#3ddc97");
    const down = cssVar("--sell", "#ff5a52");
    const c = createChart(node, {
      width: node.clientWidth,
      height: node.clientHeight,
      layout: { background: { type: ColorType.Solid, color: panel }, textColor: text3, fontFamily: cssVar("--font-mono", "ui-monospace, monospace"), fontSize: 10, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: alpha(line, 0.6) } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.08 } },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, fixLeftEdge: true, fixRightEdge: true, lockVisibleTimeRangeOnResize: true },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { color: alpha(text3, 0.5), style: LineStyle.Dashed, labelVisible: false },
        horzLine: { color: alpha(text3, 0.5), style: LineStyle.Dashed },
      },
      handleScroll: false,
      handleScale: false,
    });
    const s = c.addBaselineSeries({
      lineWidth: 2,
      topLineColor: up,
      topFillColor1: alpha(up, 0.1),
      topFillColor2: alpha(up, 0.1),
      bottomLineColor: down,
      bottomFillColor1: alpha(down, 0.1),
      bottomFillColor2: alpha(down, 0.1),
      priceLineVisible: false,
      lastValueVisible: true,
      priceFormat: { type: "custom", minMove: 1e-12, formatter: (p: number) => fmtPrice(p, 3) },
    });
    const onMove = (p: MouseEventParams<Time>) => {
      const d = p.seriesData.get(s) as { value?: number } | undefined;
      if (d && typeof d.value === "number" && typeof p.time === "number") setHover({ price: d.value, t: (p.time as number) - TZ_SHIFT_SEC });
      else setHover(null);
    };
    c.subscribeCrosshairMove(onMove);
    const ro = new ResizeObserver(() => c.applyOptions({ width: node.clientWidth, height: node.clientHeight }));
    ro.observe(node);
    chart.current = c;
    series.current = s;
    return () => {
      ro.disconnect();
      c.unsubscribeCrosshairMove(onMove);
      c.remove();
      chart.current = null;
      series.current = null;
    };
  }, []);

  const points = useMemo(() => candles.map((k) => ({ time: (k.t + TZ_SHIFT_SEC) as UTCTimestamp, value: k.c })), [candles]);

  useEffect(() => {
    const s = series.current;
    if (!s) return;
    s.setData(points);
    if (first) s.applyOptions({ baseValue: { type: "price", price: first } });
    chart.current?.timeScale().fitContent();
  }, [points, first]);

  const empty = !q.isLoading && candles.length < 2;

  return (
    <div className={cn("flex min-w-0 flex-col", className)}>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 text-[11.5px] text-text-3">
          {hover ? (
            <span className="num">
              <span className="font-semibold text-text">${fmtPrice(hover.price)}</span>{" "}
              {new Date(hover.t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          ) : change != null ? (
            <span>
              <span className={cn("num font-semibold", change >= 0 ? "text-buy" : "text-sell")}>{fmtPct(change, 1, true)}</span>{" "}
              {spanMin >= 60 ? `over the last ${Math.round(spanMin / 60)}h` : `over the last ${Math.max(1, spanMin)}m`}
            </span>
          ) : (
            <span>Price</span>
          )}
        </div>
        <div role="tablist" aria-label="Chart range" className="flex shrink-0 items-center gap-0.5 rounded-[3px] p-0.5 ring-1 ring-inset ring-line-2">
          {RANGES.map((r) => (
            <button
              key={r.id}
              role="tab"
              type="button"
              aria-selected={r.id === range}
              onClick={() => setRange(r.id)}
              className={cn("num h-7 rounded-[2px] px-2 text-[11px] font-medium transition-colors", r.id === range ? "bg-panel-3 text-text" : "text-text-3 hover:text-text-2")}
            >
              {r.label}
            </button>
          ))}
        </div>
        {fullHref && (
          <Link href={fullHref} className="hidden shrink-0 font-mono text-[11px] uppercase tracking-[0.1em] text-text-3 hover:text-text sm:inline">
            Full chart
          </Link>
        )}
      </div>
      <div className={cn("relative mt-2", height ? "" : "min-h-[140px] flex-1")} style={height ? { height } : undefined}>
        <div ref={el} className="absolute inset-0" aria-label="$CLAUDIO price chart" role="img" />
        {(empty || (q.isLoading && !candles.length)) && (
          <div className="absolute inset-0 flex items-center justify-center bg-bg-elev text-[12px] text-text-3">
            {q.isLoading ? <span className="sheen h-full w-full rounded-[2px] bg-panel-2" /> : "Price history loads once the first trades come in."}
          </div>
        )}
      </div>
    </div>
  );
}
