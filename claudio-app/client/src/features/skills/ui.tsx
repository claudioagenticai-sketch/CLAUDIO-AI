// Shared bits for the skills pages: install tabs, copy buttons, level meter, skill row.
import { useState } from "react";
import { Link } from "wouter";
import { Download } from "lucide-react";
import { CodeBlock } from "./Markdown";
import { INSTALL_TARGETS, copyText, formatBytes, targetOf, useInstallApp, type SkillCard } from "./api";
import "./skills.css";

export function CopyButton({ text, label, className = "sk-mini", copiedLabel = "Copied" }: { text: string; label: string; className?: string; copiedLabel?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={done ? `${className} sk-mini-on` : className}
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true);
          window.setTimeout(() => setDone(false), 1500);
        }
      }}
      title={text}
      aria-live="polite"
    >
      {done ? copiedLabel : label}
    </button>
  );
}

export function Level({ level }: { level: string }) {
  return (
    <span className="sk-level" data-level={level}>
      <i aria-hidden="true">
        <b />
      </i>
      {level || "—"}
    </span>
  );
}

/** "Download zip" + "Copy install" for the app picked in the install tabs. */
export function SkillActions({ skill, size = "mini" }: { skill: SkillCard; size?: "mini" | "btn" }) {
  const [app] = useInstallApp();
  const t = targetOf(app);
  const cls = size === "btn" ? "sk-btn" : "sk-mini";
  return (
    <>
      <a className={size === "btn" ? "sk-btn sk-btn-primary" : "sk-mini"} href={`/skills/${skill.slug}.zip`} download title={`Download ${skill.slug}.zip (${formatBytes(skill.bytes)})`}>
        {size === "btn" && <Download aria-hidden="true" />}
        {size === "btn" ? `Download zip · ${formatBytes(skill.bytes)}` : "Zip"}
      </a>
      <CopyButton text={t.command(skill.slug)} label={size === "btn" ? `${t.copyLabel} · ${t.label}` : t.copyLabel} className={cls} />
    </>
  );
}

export function SkillRow({ skill, n, onTag }: { skill: SkillCard; n: number; onTag?: (t: string) => void }) {
  return (
    <li className="sk-row">
      <span className="sk-row-n">{String(n).padStart(2, "0")}</span>
      <div className="min-w-0">
        <Link href={`/skills/${skill.slug}`} className="sk-row-title">
          {skill.title}
        </Link>
        <p className="sk-row-summary">{skill.summary}</p>
        {skill.tags.length > 0 && (
          <div className="sk-tags">
            {skill.tags.slice(0, 5).map((t) =>
              onTag ? (
                <button key={t} type="button" className="sk-tag" onClick={() => onTag(t)} title={`Show skills tagged ${t}`}>
                  {t}
                </button>
              ) : (
                <span key={t} className="sk-tag">
                  {t}
                </span>
              ),
            )}
          </div>
        )}
        <div className="sk-row-specs-mobile mt-3 sk-row-spec">
          <Level level={skill.level} />
          <span>{skill.time}</span>
        </div>
      </div>
      <div className="sk-row-spec sk-row-desk">
        <span className="sk-row-spec-label">Level</span>
        <Level level={skill.level} />
      </div>
      <div className="sk-row-spec sk-row-desk sk-row-time">
        <span className="sk-row-spec-label">Time</span>
        {skill.time || "—"}
      </div>
      <div className="sk-row-actions">
        <SkillActions skill={skill} />
      </div>
    </li>
  );
}

/** Install instructions with one tab per app. `slug` fills in the commands (or shows <slug>). */
export function InstallPanel({ slug, idPrefix = "install" }: { slug?: string; idPrefix?: string }) {
  const [app, setApp] = useInstallApp();
  const t = targetOf(app);
  const s = slug ?? "<slug>";
  return (
    <div className="sk-install">
      <div className="sk-install-tabs" role="tablist" aria-label="Install in">
        {INSTALL_TARGETS.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${x.id}`}
            aria-selected={x.id === app}
            aria-controls={`${idPrefix}-panel`}
            className="sk-install-tab"
            onClick={() => setApp(x.id)}
          >
            {x.label}
          </button>
        ))}
      </div>
      <div className="sk-install-body" role="tabpanel" id={`${idPrefix}-panel`} aria-labelledby={`${idPrefix}-tab-${app}`}>
        <p className="text-[14px] leading-relaxed text-text-2">{t.where}</p>
        {t.id === "claude-apps" ? (
          slug ? (
            <a className="sk-btn sk-btn-primary mt-4" href={`/skills/${slug}.zip`} download>
              <Download aria-hidden="true" /> Download {slug}.zip
            </a>
          ) : null
        ) : (
          <div className="mt-4">
            <CodeBlock text={t.command(s)} lang="sh" compact />
          </div>
        )}
        <ol className="sk-steps">
          {t.steps(s).map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="sk-label mt-4 !normal-case !tracking-[0.04em]">
          Checked 2026-10 ·{" "}
          <a href={t.source.href} target="_blank" rel="noopener noreferrer" className="underline decoration-line-2 underline-offset-2 hover:text-text">
            {t.source.label}
          </a>
        </p>
      </div>
    </div>
  );
}

export function SkeletonRows({ n = 6 }: { n?: number }) {
  return (
    <ul className="sk-rows" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <li key={i} className="sk-row">
          <span className="sk-row-n" />
          <div>
            <div className="sk-skel h-[22px] w-2/5" />
            <div className="sk-skel mt-3 h-[14px] w-4/5" />
          </div>
        </li>
      ))}
    </ul>
  );
}
