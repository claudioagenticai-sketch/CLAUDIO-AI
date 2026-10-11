// One silent loop of Claudio (client/public/claudio/media/<name>.mp4 + a -sq 1:1 crop + posters).
//  - muted, playsInline, loop, no controls, no audio, poster always set, preload="metadata"
//  - lazy: no src until the slot is near the viewport (or until `load` is true, when the parent decides)
//  - plays only while ≥ 35 % visible and the tab is visible (and `active`, when the parent passes it); pauses otherwise
//  - shape "auto": the square crop on phones (< 640 px), the vertical one in a 9:16 frame elsewhere;
//    "square" / "vertical" force one; "fill" covers whatever box the parent gives it (pick the source with `square`)
//  - prefers-reduced-motion: reduce → the poster only, never a video
// Fixed aspect boxes, so nothing shifts when the video arrives.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import "./LoopVideo.css";

export type LoopName = "room" | "club" | "lounge" | "rain";

const BASE = "/claudio/media";

export const LOOPS: Record<LoopName, { label: string; seconds: number }> = {
  room: { label: "Claudio talking to the camera in his room, laughing", seconds: 14 },
  club: { label: "Claudio dancing at a DJ set in sunglasses, under club lights", seconds: 8 },
  lounge: { label: "Claudio taking his sunglasses on and off in a lamp-lit vintage lounge", seconds: 8 },
  rain: { label: "Claudio running and filming a selfie in the rain, laughing", seconds: 13 },
};

export function loopSources(name: LoopName) {
  return {
    src: `${BASE}/${name}.mp4`,
    poster: `${BASE}/${name}-poster.jpg`,
    srcSquare: `${BASE}/${name}-sq.mp4`,
    posterSquare: `${BASE}/${name}-sq-poster.jpg`,
  };
}

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

export interface LoopVideoProps {
  name: LoopName;
  shape?: "auto" | "vertical" | "square" | "fill";
  /** With shape="fill": use the square source (default: the vertical one). */
  square?: boolean;
  /** Parent-controlled playback (e.g. the current hero slide). Undefined = play whenever visible. */
  active?: boolean;
  /** Parent-controlled loading. Undefined = load when near the viewport. Once loaded it stays loaded. */
  load?: boolean;
  /** Accessible description; defaults to the loop's scene. Pass "" for a decorative loop. */
  label?: string;
  className?: string;
  style?: CSSProperties;
  /** 8 px corner brackets around the frame. */
  brackets?: boolean;
  objectPosition?: string;
}

export function LoopVideo({ name, shape = "auto", square, active, load, label, className, style, brackets, objectPosition }: LoopVideoProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const phone = useMedia("(max-width: 639px)");
  const reduce = useMedia("(prefers-reduced-motion: reduce)");
  const [near, setNear] = useState(false);
  const [visible, setVisible] = useState(false);
  const [tabVisible, setTabVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  const [loaded, setLoaded] = useState(false);

  const useSquare = shape === "square" || (shape === "auto" && phone) || (shape === "fill" && !!square);
  const s = loopSources(name);
  const src = useSquare ? s.srcSquare : s.src;
  const poster = useSquare ? s.posterSquare : s.poster;
  const desc = label ?? LOOPS[name].label;

  // Near the viewport → allowed to load; ≥ 35 % visible → allowed to play.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      setVisible(true);
      return;
    }
    const nearIo = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && setNear(true)), { rootMargin: "600px 0px" });
    const seeIo = new IntersectionObserver((es) => es.forEach((e) => setVisible(e.isIntersecting && e.intersectionRatio >= 0.35)), {
      threshold: [0, 0.35, 0.6, 1],
    });
    nearIo.observe(el);
    seeIo.observe(el);
    return () => {
      nearIo.disconnect();
      seeIo.disconnect();
    };
  }, []);

  useEffect(() => {
    const on = () => setTabVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);

  const wantLoad = load ?? near;
  useEffect(() => {
    if (wantLoad) setLoaded(true);
  }, [wantLoad]);

  const shouldPlay = loaded && visible && tabVisible && active !== false && !reduce;
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (shouldPlay) {
      v.muted = true;
      const p = v.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    } else if (!v.paused) {
      v.pause();
    }
  }, [shouldPlay, src]);

  const box: CSSProperties =
    shape === "fill" ? { position: "absolute", inset: 0 } : { position: "relative", aspectRatio: useSquare ? "1 / 1" : "9 / 16" };

  return (
    <div
      ref={wrap}
      className={["loopvideo", brackets ? "loopvideo--brackets" : "", className ?? ""].join(" ").trim()}
      style={{ ...box, ...style }}
      data-loop={name}
      data-playing={shouldPlay ? "true" : "false"}
    >
      {reduce ? (
        <img src={poster} alt={desc} loading="lazy" decoding="async" style={media(objectPosition)} />
      ) : (
        <video
          ref={video}
          src={loaded ? src : undefined}
          poster={poster}
          muted
          playsInline
          loop
          autoPlay={shouldPlay}
          preload="metadata"
          disablePictureInPicture
          disableRemotePlayback
          aria-label={desc || undefined}
          aria-hidden={desc ? undefined : true}
          style={media(objectPosition)}
        />
      )}
      {brackets && (
        <span aria-hidden="true" className="loopvideo__brackets">
          <i />
          <i />
          <i />
          <i />
        </span>
      )}
    </div>
  );
}

const media = (objectPosition?: string): CSSProperties => ({
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  objectFit: "cover",
  objectPosition: objectPosition ?? "50% 30%",
  display: "block",
});
