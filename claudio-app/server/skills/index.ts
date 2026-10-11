// Skills library (github.com/claudio-onchain/claudio-skills), copied in by that repo's scripts/sync-site.mjs:
//   server/skills/index.json            the index (slug, title, category, summary, tags, files, zip size + sha256 …)
//   server/skills/content/<slug>/**     the raw skill files
//   client/public/skills/*.zip + index.json   static downloads (served by express.static / Vite, not here)
// Everything is read once at boot and kept in memory (a few MB at most). In development the index file's mtime is
// checked at most once a second and the cache reloads when a sync changes it.
//
//   GET /api/skills?category=&q=&tag=&level=   → { version, updated, count, total, categories, all, repo, skills[] }
//   GET /api/skills/:slug                      → { skill, markdown, body, files[], related[] }
//   GET /api/skills/:slug/file?path=           → { slug, path, bytes, text }   (text files listed in the index only)
//   GET /skills/:slug/SKILL.md, /skills/:slug.md → raw SKILL.md (text/markdown)
//   GET /skills.md                              → the catalogue as Markdown
// All of these are public, also while the site is "coming soon" (server/access.ts).
import type { Express, Request, Response } from "express";
import { existsSync, readFileSync, statSync } from "fs";
import path from "path";
import { BRAND } from "@shared/brand";

const DIR = path.resolve(process.cwd(), "server", "skills");
const INDEX = path.join(DIR, "index.json");
const CONTENT = path.join(DIR, "content");
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TEXT_RE = /\.(md|markdown|txt|json|csv|tsv|ya?ml|sh|mjs|cjs|js|ts|py|toml)$/i;
const MAX_TEXT = 512 * 1024;

export interface SkillMeta {
  slug: string;
  name: string;
  title: string;
  category: string;
  summary: string;
  description: string;
  level: string;
  tags: string[];
  uses: string[];
  time: string;
  version: string;
  updated: string;
  files: string[];
  size?: number;
  bytes: number;
  sha256: string;
  path?: string;
  zip?: string;
  related?: string[];
}

interface SkillIndex {
  version: number;
  updated: string | null;
  count: number;
  repo?: string;
  all?: { zip: string; bytes: number; sha256: string };
  categories: { id: string; title: string; summary: string; count: number }[];
  skills: SkillMeta[];
}

interface Loaded {
  index: SkillIndex;
  bySlug: Map<string, SkillMeta>;
  files: Map<string, Map<string, { bytes: number; text: string | null }>>;
  markdown: Map<string, string>;
  mtime: number;
}

const EMPTY: SkillIndex = { version: 1, updated: null, count: 0, categories: [], skills: [] };
let cache: Loaded | null = null;
let checkedAt = 0;

function load(): Loaded {
  let index = EMPTY;
  let mtime = 0;
  try {
    mtime = statSync(INDEX).mtimeMs;
    index = JSON.parse(readFileSync(INDEX, "utf8")) as SkillIndex;
  } catch {
    // No synced library yet: serve an empty catalogue rather than failing the boot.
  }
  const bySlug = new Map<string, SkillMeta>();
  const files = new Map<string, Map<string, { bytes: number; text: string | null }>>();
  const markdown = new Map<string, string>();
  for (const s of index.skills ?? []) {
    if (!SLUG_RE.test(s.slug)) continue;
    bySlug.set(s.slug, s);
    const fm = new Map<string, { bytes: number; text: string | null }>();
    for (const rel of s.files ?? []) {
      const abs = path.join(CONTENT, s.slug, rel);
      // Index paths come from our own build, but never follow one outside the skill folder.
      if (!abs.startsWith(path.join(CONTENT, s.slug) + path.sep) || !existsSync(abs)) continue;
      const bytes = statSync(abs).size;
      const text = TEXT_RE.test(rel) && bytes <= MAX_TEXT ? readFileSync(abs, "utf8") : null;
      fm.set(rel, { bytes, text });
    }
    files.set(s.slug, fm);
    const md = fm.get("SKILL.md")?.text;
    if (md) markdown.set(s.slug, md);
  }
  return { index: { ...EMPTY, ...index }, bySlug, files, markdown, mtime };
}

function lib(dev: boolean): Loaded {
  if (!cache) cache = load();
  else if (dev && Date.now() - checkedAt > 1000) {
    checkedAt = Date.now();
    let m = 0;
    try {
      m = statSync(INDEX).mtimeMs;
    } catch {
      m = 0;
    }
    if (m !== cache.mtime) cache = load();
  }
  return cache;
}

/** SKILL.md without its frontmatter. */
function bodyOf(md: string): string {
  const src = md.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  if (!src.startsWith("---\n")) return src;
  const end = src.indexOf("\n---", 3);
  if (end === -1) return src;
  const nl = src.indexOf("\n", end + 4);
  return nl === -1 ? "" : src.slice(nl + 1);
}

/** A skill's list entry: everything but the file list (the detail route has it). */
function card(s: SkillMeta) {
  const { files, ...rest } = s;
  return { ...rest, fileCount: files?.length ?? 0 };
}

function matches(s: SkillMeta, q: string): boolean {
  const hay = [s.slug, s.title, s.summary, s.description, s.category, s.level, ...(s.tags ?? []), ...(s.uses ?? [])].join(" ").toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((t) => hay.includes(t));
}

const one = (v: unknown): string => (typeof v === "string" ? v : Array.isArray(v) && typeof v[0] === "string" ? v[0] : "");

/** Accepts only plain relative paths that are listed for this skill. Returns the normalized path or null. */
export function safeSkillPath(raw: string): string | null {
  if (!raw || raw.length > 256 || /[\0\\]/.test(raw) || raw.startsWith("/") || /^[a-z]+:/i.test(raw)) return null;
  const norm = path.posix.normalize(raw);
  if (norm !== raw.replace(/^\.\//, "") || norm.startsWith("..") || norm.split("/").includes("..") || norm.startsWith("/")) return null;
  return norm;
}

function catalogueMarkdown(l: Loaded): string {
  const { index } = l;
  const site = BRAND.site;
  const out: string[] = [
    `# ${BRAND.full} skills`,
    "",
    `Agent Skills for agents and their people to create, grow, earn and run: ${index.count} skills${index.updated ? `, updated ${index.updated}` : ""}.`,
    `Each skill is a folder with a SKILL.md (Agent Skills format). Download a zip and unzip it into your agent's skills folder`,
    `(~/.claude/skills, ~/.agents/skills, ~/.cursor/skills), upload the zip in Claude (Customize → Skills), or read the raw Markdown.`,
    "",
    `- All skills (zip): ${site}/skills/claudio-skills-all.zip`,
    `- Index (JSON): ${site}/skills/index.json`,
    `- Source: ${index.repo ?? `${BRAND.github}/claudio-skills`}`,
  ];
  for (const c of index.categories) {
    const rows = index.skills.filter((s) => s.category === c.id);
    out.push("", `## ${c.title}`, "", c.summary, "");
    if (!rows.length) out.push("_Coming soon._");
    for (const s of rows) out.push(`- [${s.title}](${site}/skills/${s.slug}.md) (\`${s.slug}\`, ${s.level}, ${s.time}): ${s.summary} Zip: ${site}/skills/${s.slug}.zip`);
  }
  out.push("", "Claudio is an AI character. The platform is operated by a small team.", "");
  return out.join("\n");
}

export function registerSkillsRoutes(app: Express): void {
  const dev = app.get("env") === "development";
  const get = () => lib(dev);
  // Warm the cache at boot so the first request doesn't read the disk.
  cache = load();

  const cacheFor = (res: Response, seconds: number) => res.set("Cache-Control", dev ? "no-store" : `public, max-age=${seconds}`);

  app.get("/api/skills", (req: Request, res: Response) => {
    const l = get();
    const category = one(req.query.category).trim().toLowerCase();
    const tag = one(req.query.tag).trim().toLowerCase();
    const level = one(req.query.level).trim().toLowerCase();
    const q = one(req.query.q).trim().slice(0, 128);
    let skills = l.index.skills;
    if (category) skills = skills.filter((s) => s.category === category);
    if (level) skills = skills.filter((s) => s.level === level);
    if (tag) skills = skills.filter((s) => (s.tags ?? []).some((t) => t.toLowerCase() === tag));
    if (q) skills = skills.filter((s) => matches(s, q));
    cacheFor(res, 60);
    res.json({
      version: l.index.version,
      updated: l.index.updated,
      total: l.index.count,
      count: skills.length,
      repo: l.index.repo ?? `${BRAND.github}/claudio-skills`,
      all: l.index.all ?? null,
      categories: l.index.categories,
      skills: skills.map(card),
    });
  });

  app.get("/api/skills/:slug", (req: Request, res: Response) => {
    const l = get();
    const slug = req.params.slug;
    const s = SLUG_RE.test(slug) ? l.bySlug.get(slug) : undefined;
    if (!s) return res.status(404).json({ error: "not_found", message: "No such skill" });
    const md = l.markdown.get(slug) ?? "";
    const files = [...(l.files.get(slug) ?? new Map()).entries()].map(([p, f]) => ({ path: p, bytes: f.bytes, text: f.text !== null }));
    const related = (s.related ?? []).map((r) => l.bySlug.get(r)).filter((x): x is SkillMeta => !!x).map(card);
    cacheFor(res, 60);
    res.json({ skill: card(s), markdown: md, body: bodyOf(md), files, related });
  });

  app.get("/api/skills/:slug/file", (req: Request, res: Response) => {
    const l = get();
    const slug = req.params.slug;
    const fm = SLUG_RE.test(slug) ? l.files.get(slug) : undefined;
    if (!fm) return res.status(404).json({ error: "not_found", message: "No such skill" });
    const rel = safeSkillPath(one(req.query.path));
    if (!rel) return res.status(400).json({ error: "bad_path", message: "path must be a relative file path inside the skill" });
    const f = fm.get(rel);
    if (!f) return res.status(404).json({ error: "not_found", message: "No such file in this skill" });
    if (f.text === null) return res.status(415).json({ error: "not_text", message: "Only text files can be viewed; download the zip for this one" });
    cacheFor(res, 60);
    res.json({ slug, path: rel, bytes: f.bytes, text: f.text });
  });

  const rawSkill = (req: Request, res: Response) => {
    const slug = req.params.slug ?? req.params[0];
    const md = SLUG_RE.test(slug ?? "") ? get().markdown.get(slug) : undefined;
    if (!md) return res.status(404).type("text/plain").send("No such skill\n");
    cacheFor(res, 300);
    res.type("text/markdown; charset=utf-8").send(md);
  };
  app.get("/skills/:slug/SKILL.md", rawSkill);
  app.get(/^\/skills\/([a-z0-9-]+)\.md$/, rawSkill);

  // client/public/skills/ (the zips) is a real directory, so express.static would 301 "/skills" to "/skills/". Send the
  // SPA shell for the page itself instead (production only; in development Vite serves it).
  app.get(["/skills", "/skills/"], (_req: Request, res: Response, next) => {
    if (dev) return next();
    const shell = path.resolve(import.meta.dirname, "public", "index.html");
    if (!existsSync(shell)) return next();
    res.sendFile(shell);
  });

  app.get("/skills.md", (_req: Request, res: Response) => {
    cacheFor(res, 300);
    res.type("text/markdown; charset=utf-8").send(catalogueMarkdown(get()));
  });
}
