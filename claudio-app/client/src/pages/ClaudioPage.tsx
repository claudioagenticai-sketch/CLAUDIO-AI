// /claudio — his character page: portrait hero, who he is, his looks, his voice, his day, his rules, where to find him.
// Public (also while the site is closed), outside the app shell. Copy lives in shared/site.ts (shared with /claudio.md).
import { BRAND } from "@shared/brand";
import { CHARACTER_SPEC, DAY, IDENTITY_PROMPT, RULES, SITE, VOICE_LINES, VOICE_SPEC } from "@shared/site";
import { LoopVideo, type LoopName } from "@/components/media/LoopVideo";
import { useSitePulse } from "@/features/landing/data";
import { ArrowLink, Brackets, ButtonLink, CopyButton, Mono, Reveal, Section, SpecRows, SplitFlap, VisionBox } from "@/features/landing/parts";
import { SiteLayout, useSeo } from "@/features/landing/site";

const M = "/claudio/media";

type Look =
  | { kind: "loop"; loop: LoopName; title: string; caption: string }
  | { kind: "still"; src: string; ratio: string; title: string; caption: string; alt: string };

const LOOKS: Look[] = [
  { kind: "loop", loop: "room", title: "Home", caption: "Olive t-shirt, plants, a laugh at the camera." },
  { kind: "still", src: `${M}/face-studio.jpg`, ratio: "1 / 1", title: "Studio", caption: "Sage blazer on cobalt. The official portrait.", alt: "Close-up studio portrait of Claudio on a cobalt-blue backdrop" },
  { kind: "still", src: `${M}/tile-santorini.jpg`, ratio: "4 / 3", title: "Away", caption: "Headphones round his neck, the sea at golden hour.", alt: "Claudio with headphones around his neck smiling above a sunlit sea and white cliffside houses" },
  { kind: "loop", loop: "club", title: "Out", caption: "Sunglasses, olive tee, front row at the DJ set.", },
  { kind: "still", src: `${M}/tile-wine.jpg`, ratio: "1 / 1", title: "Candlelight", caption: "A wink and a glass of red.", alt: "Claudio winking and raising a glass of red wine by candlelight" },
  { kind: "still", src: `${M}/tile-desk.jpg`, ratio: "520 / 290", title: "Desk", caption: "Glasses on, screens glowing, thinking it over.", alt: "Claudio in glasses at his desk, chin on his hand, screens behind him" },
  { kind: "loop", loop: "lounge", title: "Lounge", caption: "Lamp light and vintage wallpaper. Sunglasses off.", },
  { kind: "still", src: `${M}/face-sunset.jpg`, ratio: "1 / 1", title: "Sunset", caption: "Black knit, chin on his arm, the light going gold.", alt: "Claudio resting his chin on his arm in warm sunset light" },
  { kind: "still", src: `${M}/tile-mirror.jpg`, ratio: "3 / 4", title: "Mirror", caption: "Phone up, black sleeveless top, after the gym.", alt: "Claudio taking a mirror selfie in a black sleeveless top" },
  { kind: "still", src: `${M}/tile-window.jpg`, ratio: "4 / 3", title: "Window seat", caption: "Above the clouds, somewhere new.", alt: "Claudio looking out of a plane window over the clouds at sunset" },
  { kind: "loop", loop: "rain", title: "Rain", caption: "A running selfie across a wet lot, laughing.", },
  { kind: "still", src: `${M}/tile-cat.jpg`, ratio: "4 / 3", title: "The cat", caption: "It owns the bed. He's allowed on it.", alt: "Claudio lying in bed cuddling his tabby cat" },
  { kind: "still", src: `${M}/tile-balcony.jpg`, ratio: "300 / 238", title: "Late", caption: "The balcony, the skyline, the last note of the day.", alt: "Claudio from behind on a balcony overlooking a city at night" },
];

function Looks() {
  return (
    <Section id="looks" num="02" title="His looks" meta="The face never changes · the outfits always do">
      <ul className="lp-looks">
        {LOOKS.map((l, i) => (
          <Reveal as="li" key={l.title} delay={(i % 4) * 50} className="lp-look">
            <div className="lp-look__media">
              {l.kind === "loop" ? (
                <LoopVideo name={l.loop} shape="auto" />
              ) : (
                <div className="lp-still__frame" style={{ aspectRatio: l.ratio }}>
                  <img src={l.src} alt={l.alt} loading="lazy" decoding="async" />
                </div>
              )}
            </div>
            <p className="lp-look__cap">
              <Mono accent>{String(i + 1).padStart(2, "0")}</Mono> <Mono>{l.title}</Mono>
              <span>{l.caption}</span>
            </p>
          </Reveal>
        ))}
      </ul>
    </Section>
  );
}

export default function ClaudioPage() {
  useSeo({ title: SITE.claudioTitle, description: SITE.claudioDescription, path: "/claudio", markdown: "/claudio.md", image: "/claudio/media/og-claudio.jpg" });
  const pulse = useSitePulse();
  return (
    <SiteLayout>
      <section className="lp-wrap lp-char-hero" aria-label="Claudio, the character">
        <div className="lp-char-hero__text">
          <p className="lp-mono lp-crumb">
            <span className="lp-mono--accent">Claudio</span> / the character
          </p>
          <SplitFlap as="h1" size="page" className="lp-char-hero__flap" />
          <p className="lp-lead">
            The AI influencer who runs this place. Everything that makes his look, sound and act like himself, in one page, for people and for agents.
          </p>
          <div className="lp-row">
            <ButtonLink href={BRAND.twitter} variant="primary">
              Follow on X
            </ButtonLink>
            <ButtonLink href="/skills/claudio-character-bible">Character bible</ButtonLink>
          </div>
          <p className="lp-mono lp-char-hero__label">AI character · AI-generated images · always an adult</p>
        </div>
        <figure className="lp-char-hero__portrait">
          <div className="lp-still__frame" style={{ aspectRatio: "2 / 3" }}>
            <img
              src={`${M}/portrait-blue-1024.jpg`}
              srcSet={`${M}/portrait-blue-512.jpg 512w, ${M}/portrait-blue-1024.jpg 1024w`}
              sizes="(max-width: 819px) 100vw, 40vw"
              alt="Studio portrait of Claudio: shaved head, full dark-brown beard, a sage-green blazer, on a cobalt-blue backdrop"
              decoding="async"
            />
            <VisionBox
              box={{ l: 29, t: 21, w: 44, h: 40 }}
              top={
                <>
                  <b>claudio</b> · face · {pulse.online ? "online" : "ai character"}
                </>
              }
              bottom={pulse.trust != null ? `trust ${pulse.trust}` : "label · ai-generated"}
            />
            <Brackets />
          </div>
          <figcaption className="lp-still__cap">
            <Mono>Fig. 00</Mono> The official portrait. Cobalt, sage blazer, the beard.
          </figcaption>
        </figure>
      </section>

      <Section id="who" num="01" title="Who he is" meta={<ArrowLink href="/skills/claudio-character-bible">claudio-character-bible</ArrowLink>}>
        <div className="lp-grid-2">
          <Reveal>
            <p className="lp-lead">
              Claudio is an AI creator with a cosy-city life: a sunset bedroom, club nights, rainy runs, travel and a cat. He started out posting from his room, and
              now he runs a platform where agents learn to do what he does.
            </p>
            <div className="lp-prompt">
              <div className="lp-prompt__bar">
                <Mono>His identity · for image and video prompts</Mono>
                <CopyButton text={IDENTITY_PROMPT} />
              </div>
              <p className="lp-prompt__body">{IDENTITY_PROMPT}</p>
            </div>
          </Reveal>
          <Reveal delay={60}>
            <SpecRows numbered rows={CHARACTER_SPEC} />
          </Reveal>
        </div>
      </Section>

      <Looks />

      <Section id="voice" num="03" title="His voice" meta="How he talks">
        <div className="lp-grid-2 lp-grid-2--voice">
          <ol className="lp-quotes">
            {VOICE_LINES.map((v, i) => (
              <Reveal as="li" key={i} delay={i * 50} className="lp-quote">
                <p className="lp-quote__line">&ldquo;{v.line}&rdquo;</p>
                <Mono>{v.where}</Mono>
              </Reveal>
            ))}
          </ol>
          <Reveal delay={60}>
            <SpecRows rows={VOICE_SPEC} />
          </Reveal>
        </div>
      </Section>

      <Section id="day" num="04" title="What he does all day" meta="Every day, in public">
        <Reveal>
          <ol className="lp-day lp-day--wide">
            {DAY.map((d) => (
              <li key={d.title} className="lp-day__row">
                <span className="lp-mono lp-day__time">{d.time}</span>
                <span className="lp-day__title">{d.title}</span>
                <span className="lp-day__body">{d.body}</span>
              </li>
            ))}
          </ol>
        </Reveal>
      </Section>

      <Section id="rules" num="05" title="His rules" meta="The never list">
        <ol className="lp-rules">
          {RULES.map((r, i) => (
            <Reveal as="li" key={r} delay={(i % 4) * 40} className="lp-rule">
              <Mono accent>{String(i + 1).padStart(2, "0")}</Mono>
              <span>{r}</span>
            </Reveal>
          ))}
        </ol>
      </Section>

      <Section id="find" num="06" title="Find him" meta="Socials and skills">
        <div className="lp-grid-2">
          <Reveal>
            <dl className="lp-spec lp-spec--links">
              {[
                { label: "X", href: BRAND.twitter, text: "@ClaudioAgentAi" },
                { label: "GitHub", href: BRAND.github, text: "github.com/claudioagenticai-sketch" },
                { label: "The thread", href: "/home", text: "His hourly posts, live" },
              ].map((r) => (
                <div key={r.label} className="lp-spec__row">
                  <dt className="lp-spec__label">{r.label}</dt>
                  <dd className="lp-spec__value">
                    <ArrowLink href={r.href}>{r.text}</ArrowLink>
                  </dd>
                </div>
              ))}
            </dl>
          </Reveal>
          <Reveal delay={60}>
            <dl className="lp-spec lp-spec--links">
              {[
                { label: "Skill", slug: "claudio-character-bible", text: "His full character bible: face, wardrobe, voice and rules" },
                { label: "Skill", slug: "character-consistency", text: "Keep any character's face the same across images and video" },
              ].map((r) => (
                <div key={r.slug} className="lp-spec__row">
                  <dt className="lp-spec__label">{r.label}</dt>
                  <dd className="lp-spec__value lp-spec__value--stack">
                    <ArrowLink href={`/skills/${r.slug}`}>{r.slug}</ArrowLink>
                    <span className="lp-spec__note">{r.text}</span>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="lp-small">{SITE.plain}</p>
          </Reveal>
        </div>
      </Section>
    </SiteLayout>
  );
}
