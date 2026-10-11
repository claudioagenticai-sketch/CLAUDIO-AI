// /skills/:slug — one skill: header, spec rows, the rendered SKILL.md, a file browser for its templates / examples /
// references, download + copy-install, install per app and related skills. ?file=<path> opens a file directly.
import { useEffect, useMemo } from "react";
import { Link, useLocation, useParams, useSearch } from "wouter";
import { ArrowLeft } from "lucide-react";
import { BRAND } from "@shared/brand";
import { formatBytes, useSkill, useSkillFile, type SkillCard } from "@/features/skills/api";
import { CodeBlock, Markdown, outline, skillResolver } from "@/features/skills/Markdown";
import { CopyButton, InstallPanel, Level, SkillActions } from "@/features/skills/ui";
import "@/features/skills/skills.css";

const CATEGORY_TITLE: Record<string, string> = { create: "Create", grow: "Grow", build: "Build" };
const GROUPS: [string, string][] = [
  ["", "Skill"],
  ["templates", "Templates"],
  ["examples", "Examples"],
  ["references", "References"],
  ["scripts", "Scripts"],
  ["assets", "Assets"],
];

const langOf = (p: string) => {
  const ext = p.split(".").pop()?.toLowerCase() ?? "";
  return ({ mjs: "js", cjs: "js", yml: "yaml" } as Record<string, string>)[ext] ?? ext;
};

export default function Skill() {
  const { slug = "" } = useParams<{ slug: string }>();
  const search = useSearch();
  const [, navigate] = useLocation();
  const file = new URLSearchParams(search).get("file");
  const { data, isLoading, error } = useSkill(slug);
  const fileQ = useSkillFile(slug, file && file !== "SKILL.md" ? file : null);
  const skill = data?.skill;

  useEffect(() => {
    if (!skill) return;
    // After the shell's own title effect.
    const id = requestAnimationFrame(() => {
      document.title = `${skill.title} · Skills · ${BRAND.full}`;
    });
    return () => cancelAnimationFrame(id);
  }, [skill]);

  // New skill → top; opening a file → the viewer (on phones it sits below the header and spec rows).
  const ready = !!data;
  useEffect(() => {
    const viewer = file ? document.getElementById("skill-viewer") : null;
    if (viewer) viewer.scrollIntoView({ block: "start" });
    else document.getElementById("main")?.scrollTo({ top: 0 });
  }, [slug, file, ready]);

  const files = useMemo(() => new Set((data?.files ?? []).map((f) => f.path)), [data]);
  const openFile = (p: string | null) => navigate(p && p !== "SKILL.md" ? `/skills/${slug}?file=${encodeURIComponent(p)}` : `/skills/${slug}`);
  const toc = useMemo(() => (data ? outline(data.body) : []), [data]);

  if (isLoading) {
    return (
      <div className="sk mx-auto w-full max-w-[1240px] px-4 pb-20 pt-8 md:px-8 md:pt-12" aria-busy="true">
        <div className="sk-skel h-3 w-40" />
        <div className="sk-skel mt-6 h-16 w-3/5" />
        <div className="sk-skel mt-5 h-4 w-4/5" />
        <div className="sk-skel mt-2 h-4 w-2/3" />
      </div>
    );
  }
  if (!data || !skill) {
    const missing = (error as { status?: number } | null)?.status === 404;
    return (
      <div className="sk mx-auto w-full max-w-[1240px] px-4 pb-20 pt-10 md:px-8 md:pt-14">
        <p className="sk-label">
          <b>404</b> &nbsp;Skills
        </p>
        <h1 className="sk-display sk-detail-title mt-4">{missing ? "No such skill" : "Didn't load"}</h1>
        <p className="sk-lede mt-4">{missing ? `There's no skill called “${slug}”.` : "The skill didn't load. Try again in a moment."}</p>
        <Link href="/skills" className="sk-btn mt-6">
          All skills
        </Link>
      </div>
    );
  }

  const viewing = file && file !== "SKILL.md" ? file : null;
  const resolveFor = (p: string) => skillResolver(skill.category, skill.slug, p, files);
  const viewingMd = viewing && /\.(md|markdown)$/i.test(viewing);
  const grouped = GROUPS.map(([dir, label]) => ({
    label,
    items: (data.files ?? []).filter((f) => (dir ? f.path.startsWith(`${dir}/`) : !f.path.includes("/"))),
  })).filter((g) => g.items.length);
  const other = (data.files ?? []).filter((f) => f.path.includes("/") && !GROUPS.some(([d]) => d && f.path.startsWith(`${d}/`)));
  if (other.length) grouped.push({ label: "Other", items: other });

  return (
    <div className="sk mx-auto w-full max-w-[1240px] px-4 pb-20 pt-8 md:px-8 md:pt-12">
      {/* Header */}
      <header>
        <nav aria-label="Breadcrumb" className="sk-label flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link href="/skills" className="inline-flex items-center gap-1.5 hover:text-text">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Skills
          </Link>
          <span aria-hidden="true">/</span>
          <Link href={`/skills?category=${skill.category}`} className="hover:text-text">
            {CATEGORY_TITLE[skill.category] ?? skill.category}
          </Link>
          <span aria-hidden="true">/</span>
          <span className="text-text-2 normal-case tracking-[0.04em]">{skill.slug}</span>
        </nav>
        <h1 className="sk-display sk-detail-title mt-5">{skill.title}</h1>
        <p className="sk-lede mt-5">{skill.summary}</p>
        <div className="mt-7 flex flex-wrap gap-2.5">
          <SkillActions skill={skill} size="btn" />
          <a className="sk-btn" href={`/skills/${skill.slug}.md`} target="_blank" rel="noopener">
            Raw SKILL.md
          </a>
        </div>
      </header>

      <div className="mt-12 grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-14">
        <article className="min-w-0">
          {/* Spec rows */}
          <dl className="sk-spec">
            <div>
              <dt>Category</dt>
              <dd>{CATEGORY_TITLE[skill.category] ?? skill.category}</dd>
            </div>
            <div>
              <dt>Level</dt>
              <dd>
                <span className="sk-row-spec">
                  <Level level={skill.level} />
                </span>
              </dd>
            </div>
            <div>
              <dt>Time</dt>
              <dd>{skill.time}</dd>
            </div>
            {skill.uses.length > 0 && (
              <div>
                <dt>Uses</dt>
                <dd className="sk-mono">{skill.uses.join(" · ")}</dd>
              </div>
            )}
            {skill.tags.length > 0 && (
              <div>
                <dt>Tags</dt>
                <dd>
                  <span className="sk-tags !mt-0">
                    {skill.tags.map((t) => (
                      <Link key={t} href={`/skills?tag=${encodeURIComponent(t)}`} className="sk-tag hover:text-text">
                        {t}
                      </Link>
                    ))}
                  </span>
                </dd>
              </div>
            )}
            <div>
              <dt>Version</dt>
              <dd className="sk-mono">
                {skill.version} · updated {skill.updated}
              </dd>
            </div>
            <div>
              <dt>Agents read</dt>
              <dd className="text-[13.5px] leading-relaxed text-text-2">{skill.description}</dd>
            </div>
            <div>
              <dt>Download</dt>
              <dd className="sk-mono">
                {skill.slug}.zip · {formatBytes(skill.bytes)} · {data.files.length} files
                <span className="mt-1 block text-[11px] text-text-3" title="SHA-256 of the zip">
                  sha256 {skill.sha256.slice(0, 16)}…
                </span>
              </dd>
            </div>
          </dl>

          {/* Body or file viewer */}
          <div className="mt-12">
            {viewing ? (
              <section id="skill-viewer" aria-label={viewing} className="scroll-mt-4">
                <div className="mb-6 flex flex-wrap items-center gap-3 border-b border-line pb-4">
                  <button type="button" className="sk-mini" onClick={() => openFile(null)}>
                    ← SKILL.md
                  </button>
                  <span className="sk-label !normal-case !tracking-[0.04em] text-text">{viewing}</span>
                  {fileQ.data && <span className="sk-label">{formatBytes(fileQ.data.bytes)}</span>}
                  {fileQ.data && <CopyButton text={fileQ.data.text} label="Copy file" className="sk-mini ml-auto" />}
                </div>
                {fileQ.isLoading && <div className="sk-skel h-40 w-full" />}
                {fileQ.isError && <p className="text-[15px] text-text-2">That file can't be shown here. It's in the zip.</p>}
                {fileQ.data &&
                  (viewingMd ? (
                    <Markdown text={fileQ.data.text} resolve={resolveFor(viewing)} onFile={openFile} />
                  ) : (
                    <CodeBlock text={fileQ.data.text} lang={langOf(viewing)} />
                  ))}
              </section>
            ) : (
              <Markdown text={data.body} resolve={resolveFor("SKILL.md")} onFile={openFile} skipTitle />
            )}
          </div>
        </article>

        {/* Sidebar */}
        <aside className="min-w-0">
          <div className="sk-side-block">
            <p className="sk-label mb-3">Files</p>
            <div className="sk-files !border-t-0">
              {grouped.map((g) => (
                <div key={g.label}>
                  <p className="sk-label border-t border-line pb-1 pt-3 !text-[10px]">{g.label}</p>
                  {g.items.map((f) => {
                    const current = (viewing ?? "SKILL.md") === f.path;
                    return (
                      <button
                        key={f.path}
                        type="button"
                        className="sk-file"
                        aria-current={current ? "true" : undefined}
                        disabled={!f.text}
                        onClick={() => openFile(f.path)}
                        title={f.text ? `View ${f.path}` : `${f.path} (in the zip)`}
                      >
                        <span className="sk-file-name">{f.path.includes("/") ? f.path.slice(f.path.indexOf("/") + 1) : f.path}</span>
                        <span className="sk-file-size">{formatBytes(f.bytes)}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {!viewing && toc.length > 2 && (
            <nav className="sk-side-block sk-toc hidden lg:block" aria-label="On this page">
              <p className="sk-label mb-2">On this page</p>
              {toc
                .filter((h) => h.depth === 2)
                .map((h) => (
                  <a
                    key={h.id}
                    href={`#${h.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      document.getElementById(h.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                  >
                    {h.text}
                  </a>
                ))}
            </nav>
          )}

          {data.related.length > 0 && (
            <div className="sk-side-block">
              <p className="sk-label mb-3">Related skills</p>
              {data.related.map((r: SkillCard) => (
                <Link key={r.slug} href={`/skills/${r.slug}`} className="sk-related">
                  <span className="sk-related-title">{r.title}</span>
                  <span className="mt-1 block text-[13px] leading-snug text-text-3">{r.summary}</span>
                </Link>
              ))}
            </div>
          )}
        </aside>
      </div>

      {/* Install */}
      <section className="sk-section mt-20" aria-labelledby="skill-install">
        <div className="sk-section-head">
          <span className="sk-label">
            <b>02</b>
          </span>
          <h2 id="skill-install" className="sk-display sk-section-title">
            Install
          </h2>
          <span className="sk-label sk-meta">{skill.slug}</span>
        </div>
        <div className="mt-6 max-w-3xl">
          <InstallPanel slug={skill.slug} idPrefix="skill-install" />
        </div>
      </section>
    </div>
  );
}
