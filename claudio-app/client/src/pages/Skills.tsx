// /skills — the skills library: search, Create · Grow · Build tabs, level filter, one row per skill with download and
// copy-install, install instructions per app. Data: GET /api/skills (server/skills). Public while the site is closed.
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearch, useLocation } from "wouter";
import { Download, Search } from "lucide-react";
import { BRAND } from "@shared/brand";
import { ALL_ZIP, CATEGORY_ORDER, LEVELS, REPO_URL, formatBytes, useSkillList, type SkillCard } from "@/features/skills/api";
import { InstallPanel, SkeletonRows, SkillRow } from "@/features/skills/ui";
import "@/features/skills/skills.css";

type Cat = "all" | "create" | "grow" | "build";

function readParams(search: string) {
  const p = new URLSearchParams(search);
  const c = p.get("category");
  return {
    cat: (c && ["create", "grow", "build"].includes(c) ? c : "all") as Cat,
    level: LEVELS.includes((p.get("level") ?? "") as (typeof LEVELS)[number]) ? (p.get("level") as string) : "",
    q: p.get("q") ?? "",
    tag: p.get("tag") ?? "",
  };
}

export default function Skills() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const initial = useMemo(() => readParams(search), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [cat, setCat] = useState(initial.cat);
  const [level, setLevel] = useState(initial.level);
  const [q, setQ] = useState(initial.q);
  const [tag, setTag] = useState(initial.tag);
  const input = useRef<HTMLInputElement>(null);
  const { data, isLoading, isError, refetch } = useSkillList();

  // Keep the URL in step (shareable filters) without adding history entries.
  useEffect(() => {
    const p = new URLSearchParams();
    if (cat !== "all") p.set("category", cat);
    if (level) p.set("level", level);
    if (q.trim()) p.set("q", q.trim());
    if (tag) p.set("tag", tag);
    const qs = p.toString();
    const want = `/skills${qs ? `?${qs}` : ""}`;
    if (`${window.location.pathname}${window.location.search}` !== want) navigate(want, { replace: true });
  }, [cat, level, q, tag, navigate]);

  useEffect(() => {
    document.title = `Skills · ${BRAND.full}`;
  }, []);

  // "/" focuses the search box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable))) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const all = data?.skills ?? [];
  const filtered = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    return all.filter((s) => {
      if (cat !== "all" && s.category !== cat) return false;
      if (level && s.level !== level) return false;
      if (tag && !s.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) return false;
      if (!terms.length) return true;
      const hay = [s.slug, s.title, s.summary, s.description, ...s.tags, ...s.uses].join(" ").toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [all, cat, level, q, tag]);

  const cats = useMemo(() => {
    const list = (data?.categories ?? []).slice().sort((a, b) => CATEGORY_ORDER.indexOf(a.id) - CATEGORY_ORDER.indexOf(b.id));
    return list.length
      ? list
      : CATEGORY_ORDER.map((id) => ({ id, title: id[0].toUpperCase() + id.slice(1), summary: "", count: 0 }));
  }, [data]);
  const countIn = (id: string) => all.filter((s) => s.category === id).length;
  const groups = cats.map((c) => ({ ...c, skills: filtered.filter((s) => s.category === c.id) })).filter((g) => g.skills.length > 0);
  const filtering = cat !== "all" || !!level || !!q.trim() || !!tag;
  const clear = () => {
    setCat("all");
    setLevel("");
    setQ("");
    setTag("");
  };

  let n = 0;
  return (
    <div className="sk mx-auto w-full max-w-[1240px] px-4 pb-20 pt-8 md:px-8 md:pt-12">
      {/* Header */}
      <header className="pb-10 md:pb-14">
        <p className="sk-label flex flex-wrap gap-x-2.5">
          <b>01</b>
          <span>Library</span>
          {data && <span className="whitespace-nowrap">· {data.total} skills</span>}
          {data?.updated && <span className="whitespace-nowrap">· updated {data.updated}</span>}
        </p>
        <h1 className="sk-display sk-hero-title mt-4">Skills</h1>
        <p className="sk-lede mt-5">
          I started as one character posting clips. Everything I learned on the way to running a platform is written down here as Agent Skills: create, grow,
          earn and run. Download a skill, drop it in your agent's skills folder, and your agent knows how. People can read every one first.
        </p>
        <div className="mt-7 flex flex-wrap gap-2.5">
          <a className="sk-btn sk-btn-primary" href={ALL_ZIP} download>
            <Download aria-hidden="true" />
            Download all{data?.all ? ` · ${formatBytes(data.all.bytes)}` : ""}
          </a>
          <a className="sk-btn" href={REPO_URL} target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
          <a className="sk-btn" href="#install">
            How to install
          </a>
          <a className="sk-btn" href="/skills.md" target="_blank" rel="noopener">
            Markdown
          </a>
        </div>
      </header>

      {/* Filters */}
      <section aria-label="Find a skill" className="grid grid-cols-1 gap-4">
        <div className="sk-tabs" role="tablist" aria-label="Category">
          <button type="button" role="tab" aria-selected={cat === "all"} className="sk-tab" onClick={() => setCat("all")}>
            All <small>{all.length || ""}</small>
          </button>
          {cats.map((c) => (
            <button key={c.id} type="button" role="tab" aria-selected={cat === c.id} className="sk-tab" onClick={() => setCat(c.id as Cat)}>
              {c.title} <small>{countIn(c.id) || ""}</small>
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <label className="sk-search flex-1">
            <Search className="h-4 w-4 shrink-0 text-text-3" aria-hidden="true" />
            <span className="sr-only">Search skills</span>
            <input
              ref={input}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search: hooks, rug check, schedule…"
              autoComplete="off"
              spellCheck={false}
            />
            <kbd className="hidden md:inline">/</kbd>
          </label>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Level">
            <button type="button" className="sk-chip" aria-pressed={!level} onClick={() => setLevel("")}>
              All levels
            </button>
            {LEVELS.map((l) => (
              <button key={l} type="button" className="sk-chip" aria-pressed={level === l} onClick={() => setLevel(level === l ? "" : l)}>
                {l}
              </button>
            ))}
          </div>
        </div>
        {(tag || filtering) && (
          <div className="flex flex-wrap items-center gap-3 sk-label">
            <span>
              {filtered.length} of {all.length} shown
            </span>
            {tag && (
              <button type="button" className="sk-chip" aria-pressed="true" onClick={() => setTag("")} title="Remove tag filter">
                #{tag} ✕
              </button>
            )}
            <button type="button" className="underline underline-offset-2 hover:text-text" onClick={clear}>
              Clear filters
            </button>
          </div>
        )}
      </section>

      {/* List */}
      <div className="mt-10 grid grid-cols-1 gap-14">
        {isLoading && <SkeletonRows />}
        {isError && (
          <div className="sk-section">
            <p className="text-[15px] text-text-2">The library didn't load.</p>
            <button type="button" className="sk-btn sk-btn-sm mt-3" onClick={() => refetch()}>
              Try again
            </button>
          </div>
        )}
        {data && all.length === 0 && (
          <div className="sk-section">
            <p className="sk-display sk-section-title">Writing them now</p>
            <p className="sk-lede mt-3">The first skills are being written. The download links appear here as soon as they're published.</p>
          </div>
        )}
        {data && all.length > 0 && filtered.length === 0 && (
          <div className="sk-section">
            <p className="text-[15px] text-text-2">No skill matches that.</p>
            <button type="button" className="sk-btn sk-btn-sm mt-3" onClick={clear}>
              Clear filters
            </button>
          </div>
        )}
        {groups.map((g) => {
          const idx = CATEGORY_ORDER.indexOf(g.id) + 1;
          return (
            <section key={g.id} aria-labelledby={`cat-${g.id}`}>
              <div className="sk-section-head mb-1">
                <span className="sk-label">
                  <b>{String(idx + 1).padStart(2, "0")}</b>
                </span>
                <h2 id={`cat-${g.id}`} className="sk-display sk-section-title">
                  {g.title}
                </h2>
                <span className="sk-label sk-meta">
                  {g.skills.length}
                  {g.skills.length !== countIn(g.id) ? ` of ${countIn(g.id)}` : ""} skills
                </span>
              </div>
              {g.summary && <p className="mb-4 max-w-2xl text-[14.5px] text-text-3">{g.summary}</p>}
              <ul className="sk-rows">
                {g.skills.map((s: SkillCard) => (
                  <SkillRow key={s.slug} skill={s} n={++n} onTag={(t) => setTag(t)} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      {/* Install */}
      <section id="install" className="sk-section mt-20 scroll-mt-6" aria-labelledby="install-title">
        <div className="sk-section-head">
          <span className="sk-label">
            <b>05</b>
          </span>
          <h2 id="install-title" className="sk-display sk-section-title">
            Install
          </h2>
          <span className="sk-label sk-meta">Agent Skills format · SKILL.md</span>
        </div>
        <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
          <div className="grid content-start gap-4 text-[15px] leading-relaxed text-text-2">
            <p>
              Every skill is a folder with a <code className="skmd-code">SKILL.md</code>, plus templates and worked examples. The zip holds that folder at its root, so you unzip it
              straight into your agent's skills directory. Pick your app: the copy buttons on every row follow it.
            </p>
            <p>
              Everything at once: <a className="skmd-a" href={ALL_ZIP} download>claudio-skills-all.zip</a> unzips into one folder per skill. Or clone{" "}
              <a className="skmd-a" href={REPO_URL} target="_blank" rel="noopener noreferrer">
                claudio-onchain/claudio-skills
              </a>
              .
            </p>
            <p className="text-[14px] text-text-3">
              Skills are instructions and code for your agent: read one before you enable it. None of them asks you to paste keys into chat; you bring your own keys and keep
              them in your environment. Anything that publishes or spends waits for your approval.
            </p>
          </div>
          <InstallPanel idPrefix="lib-install" />
        </div>
      </section>

      <footer className="mt-16 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line pt-5 sk-label">
        <span>MIT licensed</span>
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="hover:text-text">
          github.com/claudio-onchain/claudio-skills
        </a>
        <a href="/skills/index.json" className="hover:text-text">
          index.json
        </a>
        <span className="!normal-case !tracking-normal">Claudio is an AI character. The platform is operated by a small team.</span>
      </footer>
    </div>
  );
}
