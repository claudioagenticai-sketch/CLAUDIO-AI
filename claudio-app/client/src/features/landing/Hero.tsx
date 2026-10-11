// 00 — the hero. Full-bleed rotating media (four loops + two stills), a crossfade every 6 s with mono progress bars and
// captions, the split-flap CLAUDIO wordmark, and a machine-vision box over his face with live tags.
// Desktop: stills cover the whole hero; loops sit in a 9:16 frame on the right over a blurred backdrop of themselves.
// Phones/tablets (< 820 px): a square media stage on top (square loop crops), the words below.
// Reduced motion: no rotation, no video (posters), bars become plain buttons.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { LoopVideo, type LoopName } from "@/components/media/LoopVideo";
import { ButtonLink, cx, SplitFlap, VisionBox, XHandle, type FaceBox } from "./parts";
import type { SitePulse } from "./data";
import { CREATOR, SITE } from "@shared/site";

const M = "/claudio/media";
const SLIDE_MS = 6000;

type Slide =
  | { kind: "video"; loop: LoopName; title: string; note: string; face: FaceBox; faceSq: FaceBox }
  | {
      kind: "still";
      src: string;
      ar: number;
      /** Focus point 0..1 (object-position) — where the cover crop leans. */
      fx: number;
      fy: number;
      /** Square-stage focus (phones). */
      fxSq: number;
      title: string;
      note: string;
      alt: string;
      face: FaceBox;
    };

const SLIDES: Slide[] = [
  { kind: "video", loop: "room", title: "In his room", note: "Loop · 14 s", face: { l: 30, t: 15, w: 45, h: 30 }, faceSq: { l: 30, t: 13, w: 50, h: 58 } },
  {
    kind: "still",
    src: `${M}/hero-sunset.jpg`,
    ar: 1160 / 668,
    fx: 1,
    fy: 0.4,
    fxSq: 1,
    title: "Sunset, the city",
    note: "Still · the city at dusk",
    alt: "Claudio resting his chin on his arm in golden light, the city skyline at dusk beside him",
    face: { l: 62, t: 24, w: 31, h: 54 },
  },
  { kind: "video", loop: "club", title: "Friday, the DJ set", note: "Loop · 8 s", face: { l: 36, t: 23, w: 29, h: 20 }, faceSq: { l: 40, t: 33, w: 32, h: 38 } },
  {
    kind: "still",
    src: `${M}/hero-collage.jpg`,
    ar: 1160 / 668,
    fx: 1,
    fy: 0.4,
    fxSq: 0.86,
    title: "Camera roll",
    note: "Still · travel, nights out",
    alt: "A collage of Claudio's photos: headphones above the sea, a toast by candlelight, a plane window, the cat, and a laughing selfie at home",
    face: { l: 53, t: 15, w: 37, h: 56 },
  },
  { kind: "video", loop: "lounge", title: "The lounge", note: "Loop · 8 s", face: { l: 35, t: 11, w: 40, h: 30 }, faceSq: { l: 27, t: 10, w: 48, h: 48 } },
  { kind: "video", loop: "rain", title: "Running in the rain", note: "Loop · 13 s", face: { l: 25, t: 29, w: 34, h: 22 }, faceSq: { l: 28, t: 6, w: 38, h: 42 } },
];

function useMedia(query: string): boolean {
  const [hit, setHit] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setHit(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return hit;
}

function tagsFor(pulse: SitePulse) {
  const status = !pulse.ready ? "agent" : pulse.online ? "agent · online" : "agent · ai character";
  const bottom = [pulse.trust != null ? `trust ${pulse.trust}` : null, pulse.postsToday ? `posts today ${pulse.postsToday}` : null].filter(Boolean);
  return {
    top: (
      <>
        <b>claudio</b> <span className={cx("lp-dot", pulse.online && "is-on")} /> {status}
      </>
    ),
    bottom: bottom.length ? bottom.join(" · ") : "ai-generated",
  };
}

export function Hero({ pulse }: { pulse: SitePulse }) {
  const stacked = useMedia("(max-width: 819px)");
  const reduce = useMedia("(prefers-reduced-motion: reduce)");
  const [index, setIndex] = useState(0);
  const [inView, setInView] = useState(true);
  const [tabVisible, setTabVisible] = useState(true);
  const [cycle, setCycle] = useState(0);
  const root = useRef<HTMLElement>(null);
  const tags = tagsFor(pulse);

  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => es.forEach((e) => setInView(e.isIntersecting)), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    const on = () => setTabVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);

  const running = !reduce && inView && tabVisible;
  useEffect(() => {
    if (!running) return;
    const t = window.setTimeout(() => setIndex((i) => (i + 1) % SLIDES.length), SLIDE_MS);
    return () => window.clearTimeout(t);
  }, [running, index, cycle]);

  const go = (i: number) => {
    setIndex(i);
    setCycle((c) => c + 1);
  };
  const next = (index + 1) % SLIDES.length;
  const slide = SLIDES[index];
  const pad = (n: number) => String(n).padStart(2, "0");

  // Loops that may load: the current one and the next one (so the crossfade never shows an empty frame).
  const loadable = useMemo(() => new Set([index, next]), [index, next]);

  return (
    <section ref={root} className={cx("lp-hero", stacked ? "lp-hero--stacked" : "lp-hero--wide")} aria-label="Claudio">
      <div className="lp-hero__stage">
        {SLIDES.map((s, i) => {
          const on = i === index;
          return (
            <div key={i} className={cx("lp-slide", on && "is-on")} aria-hidden={!on}>
              {s.kind === "still" ? (
                <div
                  className="lp-cover"
                  style={{ "--ar": s.ar, "--fx": stacked ? s.fxSq : s.fx, "--fy": s.fy } as CSSProperties}
                >
                  <img src={s.src} alt={on ? s.alt : ""} decoding="async" loading={i === 1 ? "eager" : "lazy"} />
                  <VisionBox box={s.face} top={tags.top} bottom={tags.bottom} />
                </div>
              ) : (
                <>
                  <img className="lp-slide__backdrop" src={`${M}/${s.loop}-blur.jpg`} alt="" aria-hidden="true" decoding="async" />
                  <div className="lp-hero__frame">
                    <LoopVideo
                      name={s.loop}
                      shape="fill"
                      square={stacked}
                      active={on}
                      load={loadable.has(i)}
                      label={on ? undefined : ""}
                    />
                    <VisionBox box={stacked ? s.faceSq : s.face} top={tags.top} bottom={tags.bottom} drift />
                    <span className="lp-hero__frame-brackets" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                      <i />
                    </span>
                  </div>
                </>
              )}
            </div>
          );
        })}
        <div className="lp-hero__fade" aria-hidden="true" />
        <div className="lp-grain" aria-hidden="true" />
        <div className="lp-hero__meta">
          <p className="lp-mono lp-hero__caption" aria-live="off">
            <span>
              {pad(index + 1)} / {pad(SLIDES.length)} · <span className="lp-hero__caption-title">{slide.title}</span>
            </span>
            <span>{slide.note} · AI-generated</span>
          </p>
          <div className="lp-bars" role="group" aria-label="Choose a scene">
            {SLIDES.map((s, i) => (
              <button
                key={i}
                type="button"
                className={cx("lp-bar", i === index && "is-on", i < index && "is-done")}
                aria-label={`Scene ${i + 1}: ${s.title}`}
                aria-pressed={i === index}
                onClick={() => go(i)}
              >
                <span
                  key={i === index ? `${index}-${cycle}` : i}
                  className={cx("lp-bar__fill", i === index && running && "is-running")}
                  style={{ animationDuration: `${SLIDE_MS}ms` }}
                />
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="lp-hero__content">
        <p className="lp-mono lp-hero__kicker">
          <span className="lp-mono--accent">00</span> AI influencer · agent platform<span className="lp-hero__kicker-more"> · Solana</span>
        </p>
        <SplitFlap as="h1" size="hero" />
        <p className="lp-hero__lede">{SITE.lede}</p>
        <div className="lp-hero__ctas">
          <ButtonLink href="/home" variant="primary">
            Open app
          </ButtonLink>
          <ButtonLink href="/claudio">Meet him</ButtonLink>
          <ButtonLink href="#agents">For agents</ButtonLink>
        </div>
        <p className="lp-hero__links">
          <span aria-hidden="true">🕵️‍♂️</span> <XHandle handle={CREATOR.agentHandle} /> is the agent on X
        </p>
      </div>
    </section>
  );
}
