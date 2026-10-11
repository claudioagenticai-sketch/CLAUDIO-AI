// Skills library: types, data hooks and the per-app install commands. Server side: server/skills/index.ts.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BRAND } from "@shared/brand";

export interface SkillCard {
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
  bytes: number;
  sha256: string;
  size?: number;
  zip?: string;
  related?: string[];
  fileCount: number;
}

export interface SkillCategory {
  id: string;
  title: string;
  summary: string;
  count: number;
}

export interface SkillList {
  version: number;
  updated: string | null;
  total: number;
  count: number;
  repo: string;
  all: { zip: string; bytes: number; sha256: string } | null;
  categories: SkillCategory[];
  skills: SkillCard[];
}

export interface SkillFile {
  path: string;
  bytes: number;
  text: boolean;
}

export interface SkillDetail {
  skill: SkillCard;
  markdown: string;
  body: string;
  files: SkillFile[];
  related: SkillCard[];
}

export const REPO_URL = "https://github.com/claudio-onchain/claudio-skills";
export const ALL_ZIP = "/skills/claudio-skills-all.zip";

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw Object.assign(new Error(`${r.status}`), { status: r.status });
  return (await r.json()) as T;
}

export function useSkillList() {
  return useQuery({ queryKey: ["skills", "list"], queryFn: () => getJson<SkillList>("/api/skills"), staleTime: 60_000 });
}

export function useSkill(slug: string) {
  return useQuery({
    queryKey: ["skills", "detail", slug],
    queryFn: () => getJson<SkillDetail>(`/api/skills/${encodeURIComponent(slug)}`),
    staleTime: 60_000,
    enabled: !!slug,
  });
}

export function useSkillFile(slug: string, path: string | null) {
  return useQuery({
    queryKey: ["skills", "file", slug, path],
    queryFn: () => getJson<{ path: string; bytes: number; text: string }>(`/api/skills/${encodeURIComponent(slug)}/file?path=${encodeURIComponent(path ?? "")}`),
    staleTime: 60_000,
    enabled: !!slug && !!path,
  });
}

// ─── Install targets ─────────────────────────────────────────────────

export type AppId = "claude-code" | "claude-apps" | "codex" | "cursor" | "any";

export interface InstallTarget {
  id: AppId;
  label: string;
  /** Short note under the command. */
  where: string;
  steps: (slug: string) => string[];
  /** What "Copy install" copies for this app. */
  command: (slug: string) => string;
  copyLabel: string;
  source: { label: string; href: string };
}

const SITE = BRAND.site;
const zipUrl = (slug: string) => `${SITE}/skills/${slug}.zip`;
const unzipInto = (dir: string, slug: string) => `mkdir -p ${dir} && curl -fsSLo /tmp/${slug}.zip ${zipUrl(slug)} && unzip -oq /tmp/${slug}.zip -d ${dir}`;

// Paths checked against each app's docs, 2026-10 (see claudio-skills/README.md for the sources).
export const INSTALL_TARGETS: InstallTarget[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    where: "Personal skills live in ~/.claude/skills/<name>/; project skills in .claude/skills/<name>/. Claude uses a skill when your request matches, or call it with /<name>.",
    steps: () => ["Run the command in a terminal.", "Claude Code picks it up in a running session (run /reload-skills if the folder is new)."],
    command: (slug) => unzipInto("~/.claude/skills", slug),
    copyLabel: "Copy install",
    source: { label: "code.claude.com/docs/en/skills", href: "https://code.claude.com/docs/en/skills" },
  },
  {
    id: "claude-apps",
    label: "Claude apps",
    where: "Uploaded skills are personal to your account. Code execution has to be on (Settings → Capabilities).",
    steps: () => ["Download the zip. Don't unzip it.", "In Claude, open Customize → Skills, click +, then Create skill → Upload a skill.", "Pick the zip. The skill appears in your list."],
    command: (slug) => zipUrl(slug),
    copyLabel: "Copy zip link",
    source: { label: "support.claude.com: using skills", href: "https://support.claude.com/en/articles/12512180-using-skills-in-claude" },
  },
  {
    id: "codex",
    label: "Codex",
    where: "User skills live in ~/.agents/skills/; repository skills in .agents/skills/. Mention one with $<name>.",
    steps: () => ["Run the command in a terminal.", "Start a new Codex session; it lists the skill."],
    command: (slug) => unzipInto("~/.agents/skills", slug),
    copyLabel: "Copy install",
    source: { label: "Codex: build skills", href: "https://learn.chatgpt.com/docs/build-skills" },
  },
  {
    id: "cursor",
    label: "Cursor",
    where: "Cursor reads ~/.cursor/skills/ and ~/.agents/skills/ (project: .cursor/skills/, .agents/skills/), and also the Claude and Codex folders.",
    steps: () => ["Run the command in a terminal.", "Type / in Agent chat and search for the skill, or let the agent pick it."],
    command: (slug) => unzipInto("~/.cursor/skills", slug),
    copyLabel: "Copy install",
    source: { label: "cursor.com/docs/context/skills", href: "https://cursor.com/docs/context/skills" },
  },
  {
    id: "any",
    label: "Any agent",
    where: "The open-source skills CLI knows the skills folders of Claude Code, Codex, Cursor and many more. Or hand your agent the raw Markdown.",
    steps: (slug) => [`Raw Markdown: ${SITE}/skills/${slug}.md`, `Catalogue: ${SITE}/skills.md`],
    command: (slug) => `npx skills add claudio-onchain/claudio-skills --skill ${slug}`,
    copyLabel: "Copy install",
    source: { label: "github.com/vercel-labs/skills", href: "https://github.com/vercel-labs/skills" },
  },
];

const APP_KEY = "claudio.skills.app";

/** The app the visitor picked in the install tabs; row "Copy install" buttons follow it. Shared across components. */
const listeners = new Set<(a: AppId) => void>();
let current: AppId = (() => {
  try {
    const v = localStorage.getItem(APP_KEY) as AppId | null;
    return v && INSTALL_TARGETS.some((t) => t.id === v) ? v : "claude-code";
  } catch {
    return "claude-code";
  }
})();

export function useInstallApp(): [AppId, (a: AppId) => void] {
  const [app, setApp] = useState(current);
  useEffect(() => {
    listeners.add(setApp);
    return () => {
      listeners.delete(setApp);
    };
  }, []);
  const set = (a: AppId) => {
    current = a;
    try {
      localStorage.setItem(APP_KEY, a);
    } catch {
      // private mode: the choice lasts for this page only
    }
    listeners.forEach((l) => l(a));
  };
  return [app, set];
}

export const targetOf = (id: AppId) => INSTALL_TARGETS.find((t) => t.id === id) ?? INSTALL_TARGETS[0];

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 KB";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const CATEGORY_ORDER = ["create", "grow", "build"];
export const LEVELS = ["beginner", "intermediate", "advanced"] as const;
