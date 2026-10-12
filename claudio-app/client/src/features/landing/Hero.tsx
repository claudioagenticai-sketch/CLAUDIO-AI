// 00 — the hero, laid out like a magazine cover: the words on the left (kicker, CLAUDIO wordmark, lede, actions) and a
// three-photo mosaic on the right (the cobalt studio portrait, the sea at golden hour, the chin-on-arm close-up).
// Static and light: no rotation, no video, nothing to pause for reduced motion. Phones stack the mosaic under the words.
import { ButtonLink, cx, SplitFlap, XHandle } from "./parts";
import type { SitePulse } from "./data";
import { CREATOR, SITE } from "@shared/site";

const M = "/claudio/media";

export function Hero({ pulse }: { pulse: SitePulse }) {
  return (
    <section className="lp-cover-hero" aria-label="Claudio">
      <div className="lp-wrap lp-cover-hero__grid">
        <div className="lp-cover-hero__text">
          <p className="lp-mono lp-hero__kicker">
            <span className="lp-mono--accent">00</span> Claudia&rsquo;s boyfriend · AI creator · Solana
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
            <span className={cx("lp-dot", pulse.online && "is-on")} aria-hidden="true" /> <XHandle handle={CREATOR.agentHandle} /> posts on X every day
          </p>
        </div>

        <div className="lp-mosaic" aria-label="Photos of Claudio, AI-generated">
          <figure className="lp-mosaic__tile lp-mosaic__tile--a">
            <img
              src={`${M}/portrait-blue-1024.jpg`}
              srcSet={`${M}/portrait-blue-512.jpg 512w, ${M}/portrait-blue-1024.jpg 1024w`}
              sizes="(max-width: 819px) 60vw, 30vw"
              alt="Studio portrait of Claudio: shaved head, full dark-brown beard, a sage-green blazer, on a cobalt-blue backdrop"
              decoding="async"
            />
          </figure>
          <figure className="lp-mosaic__tile lp-mosaic__tile--b">
            <img src={`${M}/tile-santorini.jpg`} alt="Claudio with headphones around his neck above the sea at golden hour" decoding="async" />
          </figure>
          <figure className="lp-mosaic__tile lp-mosaic__tile--c">
            <img src={`${M}/face-sunset.jpg`} alt="Claudio resting his chin on his arm in warm golden light" decoding="async" />
          </figure>
          <p className="lp-mosaic__stamp lp-mono">
            Issue 01 · <span className="lp-mono--accent">AI-generated</span>
          </p>
        </div>
      </div>
    </section>
  );
}
