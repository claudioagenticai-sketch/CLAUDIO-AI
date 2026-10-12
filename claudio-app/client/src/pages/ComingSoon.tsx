import { useEffect, useRef, useState } from "react";
import { CLAUDIO_TOKEN } from "@shared/platform";
import { PARTNER } from "@shared/site";
import "./ComingSoon.css";

const CONTRACT_ADDRESS = CLAUDIO_TOKEN.mint;
/** Until $CLAUDIO launches, the mint in shared/platform.ts is still Claudia's: never show hers as his. */
const LAUNCHED = CONTRACT_ADDRESS !== PARTNER.mint;
// On phones the address breaks into two even halves instead of wrapping one stray character.
const HALF = Math.ceil(CONTRACT_ADDRESS.length / 2);
const CA_HEAD = CONTRACT_ADDRESS.slice(0, HALF);
const CA_TAIL = CONTRACT_ADDRESS.slice(HALF);

export default function ComingSoon() {
  const [copyState, setCopyState] = useState<"idle" | "success" | "error">("idle");
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
  }, []);

  async function copyAddress() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(CONTRACT_ADDRESS);
      } else {
        const field = document.createElement("textarea");
        field.value = CONTRACT_ADDRESS;
        field.setAttribute("readonly", "");
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.appendChild(field);
        field.select();
        const copied = document.execCommand("copy");
        document.body.removeChild(field);
        if (!copied) throw new Error("Copy was not available");
      }
      setCopyState("success");
    } catch {
      setCopyState("error");
    }
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setCopyState("idle"), 2200);
  }

  const feedback = copyState === "success"
    ? "Address copied"
    : copyState === "error"
      ? "Could not copy — please select the address"
      : " ";

  return (
    <main className="claudio-page">
      <div className="claudio-atmosphere" aria-hidden="true">
        <span className="claudio-haze claudio-haze-blue" />
        <span className="claudio-haze claudio-haze-rose" />
        <span className="claudio-haze claudio-haze-green" />
        <svg className="claudio-signal-field" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">
          <g className="claudio-signal-orbit" fill="none">
            <path d="M-120 620C140 560 165 282 410 304s268 247 492 160 310-246 632-136" />
            <path d="M-100 684C147 626 198 368 406 363s260 208 481 136 346-214 601-111" />
            <path d="M-120 550C113 499 164 195 422 240s289 266 507 166 318-228 600-143" />
          </g>
          <g className="claudio-signal-points">
            <circle cx="410" cy="304" r="3" />
            <circle cx="902" cy="464" r="3.5" />
            <circle cx="1175" cy="354" r="2.5" />
            <circle cx="406" cy="363" r="2" />
          </g>
        </svg>
      </div>

      <section className="claudio-stage" aria-label="Claudio coming soon">
        <div className="claudio-portrait">
          <img src="/claudio/portrait-full.webp" alt="Claudio, smiling, in a green blazer against a cobalt backdrop" width={880} height={1320} decoding="async" />
          <span className="claudio-photo-glint" aria-hidden="true" />
        </div>
        <div className="claudio-side">
          <div className="claudio-brand">
            <img className="claudio-mark" src="/claudio/face-128.webp" alt="" width={128} height={128} aria-hidden="true" />
            <span className="claudio-wordmark">Claudio</span>
          </div>
          <p className="claudio-hint">Claudia&rsquo;s boyfriend <span aria-hidden="true">×</span> AI creator</p>
          <h1 className="claudio-title">Coming <em>soon.</em></h1>
          <p className="claudio-tease">A new signal is forming.</p>
          <nav className="claudio-socials" aria-label="Claudio social profiles">
            <a href="https://x.com/ClaudioAgentAi" target="_blank" rel="noopener noreferrer" aria-label="Claudio on X (opens in a new tab)">
              <img src="/claudio/x-logo-white.png" alt="" width="22" height="22" />
              <span>X</span>
            </a>
          </nav>
          <div className="claudio-ca">
            <p className="claudio-ca-label">CA <span aria-hidden="true">·</span> Solana</p>
            {LAUNCHED ? (
            <button
              className="claudio-copy"
              type="button"
              onClick={copyAddress}
              aria-label={`Copy contract address ${CONTRACT_ADDRESS}`}
            >
              <span className="claudio-address" translate="no">
                <span>{CA_HEAD}</span>
                <wbr />
                <span>{CA_TAIL}</span>
              </span>
              <span className="claudio-copy-icon" aria-hidden="true">
                {copyState === "success" ? (
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="m5 12.5 4.4 4.4L19 7.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none">
                    <rect x="8" y="8" width="11" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
                    <path d="M15 8V5.5A1.5 1.5 0 0 0 13.5 4h-8A1.5 1.5 0 0 0 4 5.5v10A1.5 1.5 0 0 0 5.5 17H8" stroke="currentColor" strokeWidth="1.6" />
                  </svg>
                )}
              </span>
            </button>
            ) : (
              <p className="claudio-copy claudio-copy--soon">
                <span className="claudio-address">$CLAUDIO · announced at launch</span>
              </p>
            )}
            {LAUNCHED && <p className="claudio-feedback" data-state={copyState} aria-live="polite">{feedback}</p>}
          </div>
          <nav className="claudio-legal" aria-label="Legal and docs">
            <a href="/docs">Docs</a>
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
          </nav>
        </div>
      </section>
    </main>
  );
}
