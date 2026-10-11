// A small, safe Markdown renderer for skill files: headings, paragraphs, lists (nested, task items), fenced code with
// a copy button, GFM tables, blockquotes, rules, and inline code / bold / italic / strike / links.
// No raw HTML ever reaches the DOM: everything becomes React elements, so HTML in a skill shows up as text.
// Links: http(s) open in a new tab; links inside the skill open its file viewer; links to other skills route to them.
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { copyText } from "./api";

type Align = "" | "left" | "center" | "right";
type Block =
  | { t: "h"; depth: number; text: string; id: string }
  | { t: "p"; text: string }
  | { t: "code"; lang: string; text: string }
  | { t: "list"; ordered: boolean; start: number; items: { task: boolean | null; blocks: Block[] }[] }
  | { t: "quote"; blocks: Block[] }
  | { t: "table"; align: Align[]; head: string[]; rows: string[][] }
  | { t: "hr" };

const FENCE = /^(\s*)(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])(\s+|$)/;
const QUOTE = /^\s{0,3}>\s?/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

const indentOf = (s: string) => s.length - s.trimStart().length;
const isBlank = (s: string) => s.trim() === "";

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  let code = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (c === "`") {
      code = !code;
      cur += c;
    } else if (c === "|" && !code) {
      cells.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

function startsBlock(line: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || HR.test(line) || QUOTE.test(line) || LIST.test(line) || line.trimStart().startsWith("<!--");
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[`*_~[\]()]/g, "")
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-") || "section"
  );
}

function parseBlocks(lines: string[], ids: Map<string, number>): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }
    // HTML comments are dropped.
    if (line.trimStart().startsWith("<!--")) {
      while (i < lines.length && !lines[i].includes("-->")) i++;
      i++;
      continue;
    }
    const f = FENCE.exec(line);
    if (f) {
      const ind = f[1].length;
      const mark = f[2];
      const body: string[] = [];
      i++;
      while (i < lines.length) {
        const l = lines[i];
        const close = /^\s*(`{3,}|~{3,})\s*$/.exec(l);
        if (close && close[1][0] === mark[0] && close[1].length >= mark.length) {
          i++;
          break;
        }
        body.push(l.slice(Math.min(ind, indentOf(l))));
        i++;
      }
      out.push({ t: "code", lang: f[3] ?? "", text: body.join("\n") });
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      const base = slugify(h[2]);
      const n = ids.get(base) ?? 0;
      ids.set(base, n + 1);
      out.push({ t: "h", depth: h[1].length, text: h[2], id: n ? `${base}-${n}` : base });
      i++;
      continue;
    }
    if (HR.test(line)) {
      out.push({ t: "hr" });
      i++;
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map((c): Align => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : ""));
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && !isBlank(lines[i]) && lines[i].includes("|")) rows.push(splitRow(lines[i++]));
      out.push({ t: "table", align, head, rows });
      continue;
    }
    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) inner.push(lines[i++].replace(QUOTE, ""));
      out.push({ t: "quote", blocks: parseBlocks(inner, ids) });
      continue;
    }
    const lm = LIST.exec(line);
    if (lm) {
      const baseIndent = lm[1].length;
      const ordered = /\d/.test(lm[2]);
      const items: { task: boolean | null; lines: string[] }[] = [];
      let contentIndent = 0;
      while (i < lines.length) {
        const l = lines[i];
        const m = LIST.exec(l);
        if (m && indentOf(l) <= baseIndent + 1 && /\d/.test(m[2]) === ordered) {
          contentIndent = m[1].length + m[2].length + Math.max(1, Math.min(m[3].length, 4));
          let first = l.slice(Math.min(l.length, contentIndent));
          if (m[3] === "") first = "";
          let task: boolean | null = null;
          const t = /^\[([ xX])\]\s+/.exec(first);
          if (t) {
            task = t[1] !== " ";
            first = first.slice(t[0].length);
          }
          items.push({ task, lines: [first] });
          i++;
          continue;
        }
        if (isBlank(l)) {
          // A blank line continues the item only if the next non-blank line is indented into it (or is a new item).
          let j = i + 1;
          while (j < lines.length && isBlank(lines[j])) j++;
          if (j < lines.length) {
            const nm = LIST.exec(lines[j]);
            const sameList = nm && indentOf(lines[j]) <= baseIndent + 1 && /\d/.test(nm[2]) === ordered;
            if (indentOf(lines[j]) >= contentIndent || sameList) {
              items[items.length - 1].lines.push("");
              i++;
              continue;
            }
          }
          break;
        }
        if (indentOf(l) >= contentIndent) {
          items[items.length - 1].lines.push(l.slice(contentIndent));
          i++;
          continue;
        }
        if (indentOf(l) > baseIndent && LIST.test(l)) {
          // A nested list indented less than the content column still belongs to the item.
          items[items.length - 1].lines.push(l.slice(Math.min(indentOf(l), baseIndent + 2)));
          i++;
          continue;
        }
        // Lazy continuation of the item's paragraph.
        const prev = items[items.length - 1].lines;
        if (!startsBlock(l) && prev.length && !isBlank(prev[prev.length - 1])) {
          prev.push(l.trim());
          i++;
          continue;
        }
        break;
      }
      out.push({
        t: "list",
        ordered,
        start: ordered ? parseInt(lm[2], 10) || 1 : 1,
        items: items.map((it) => ({ task: it.task, blocks: parseBlocks(it.lines, ids) })),
      });
      continue;
    }
    // Paragraph
    const para: string[] = [];
    while (i < lines.length && !isBlank(lines[i]) && !(para.length && startsBlock(lines[i])) && !(lines[i].includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]))) {
      para.push(lines[i]);
      i++;
    }
    if (!para.length) {
      para.push(lines[i]);
      i++;
    }
    out.push({ t: "p", text: para.join("\n") });
  }
  return out;
}

// ─── Inline ───────────────────────────────────────────────────────────

export type LinkTarget =
  | { kind: "external"; href: string }
  | { kind: "route"; href: string }
  | { kind: "file"; path: string }
  | { kind: "anchor"; id: string }
  | { kind: "none" };

interface Ctx {
  resolve: (href: string) => LinkTarget;
  onFile?: (path: string) => void;
}

function renderLink(target: LinkTarget, children: ReactNode, key: string, ctx: Ctx, title?: string): ReactNode {
  switch (target.kind) {
    case "external":
      return (
        <a key={key} href={target.href} target="_blank" rel="noopener noreferrer nofollow" className="skmd-a" title={title}>
          {children}
        </a>
      );
    case "route":
      return (
        <Link key={key} href={target.href} className="skmd-a" title={title}>
          {children}
        </Link>
      );
    case "file":
      return (
        <button key={key} type="button" className="skmd-a skmd-filelink" onClick={() => ctx.onFile?.(target.path)} title={title ?? `Open ${target.path}`}>
          {children}
        </button>
      );
    case "anchor":
      return (
        <a
          key={key}
          href={`#${target.id}`}
          className="skmd-a"
          onClick={(e) => {
            e.preventDefault();
            document.getElementById(target.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        >
          {children}
        </a>
      );
    default:
      return <span key={key}>{children}</span>;
  }
}

/** Finds the matching ] for a [ at `start`, honouring nesting and backslash escapes. */
function closeBracket(s: string, start: number): number {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") i++;
    else if (c === "`") {
      const end = s.indexOf("`", i + 1);
      if (end === -1) return -1;
      i = end;
    } else if (c === "[") depth++;
    else if (c === "]" && --depth === 0) return i;
  }
  return -1;
}

function inline(s: string, ctx: Ctx, keyBase = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  let buf = "";
  let k = 0;
  const key = () => `${keyBase}-${k++}`;
  const flush = () => {
    if (buf) out.push(buf);
    buf = "";
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    const rest = s.slice(i);
    // Escapes
    if (c === "\\" && i + 1 < s.length && /[\\`*_{}[\]()#+\-.!|~<>]/.test(s[i + 1])) {
      buf += s[i + 1];
      i += 2;
      continue;
    }
    // Hard break: two spaces or backslash at end of line
    if (c === "\n") {
      if (/ {2,}$/.test(buf) || buf.endsWith("\\")) {
        buf = buf.replace(/( {2,}|\\)$/, "");
        flush();
        out.push(<br key={key()} />);
      } else buf += " ";
      i++;
      continue;
    }
    // Inline code
    if (c === "`") {
      const run = /^`+/.exec(rest)![0];
      const end = s.indexOf(run, i + run.length);
      if (end !== -1) {
        flush();
        let code = s.slice(i + run.length, end).replace(/\n/g, " ");
        if (/^ .* $/.test(code)) code = code.slice(1, -1);
        out.push(
          <code key={key()} className="skmd-code">
            {code}
          </code>,
        );
        i = end + run.length;
        continue;
      }
      buf += run;
      i += run.length;
      continue;
    }
    // Links and images
    if (c === "[" || (c === "!" && s[i + 1] === "[")) {
      const img = c === "!";
      const open = img ? i + 1 : i;
      const close = closeBracket(s, open);
      if (close !== -1 && s[close + 1] === "(") {
        const m = /^\(\s*<?([^\s)>]*)>?(?:\s+"([^"]*)")?\s*\)/.exec(s.slice(close + 1));
        if (m) {
          flush();
          const text = s.slice(open + 1, close);
          const target = ctx.resolve(m[1]);
          const children = img ? [`${text || "image"}`] : inline(text, ctx, `${keyBase}-l${k}`);
          out.push(renderLink(target, children, key(), ctx, m[2]));
          i = close + 1 + m[0].length;
          continue;
        }
      }
    }
    // Autolinks <https://…>
    if (c === "<") {
      const m = /^<(https?:\/\/[^\s>]+)>/.exec(rest);
      if (m) {
        flush();
        out.push(renderLink({ kind: "external", href: m[1] }, m[1], key(), ctx));
        i += m[0].length;
        continue;
      }
    }
    // Bare URLs
    if (c === "h" && /^https?:\/\//.test(rest) && !/[\w/]$/.test(buf)) {
      const m = /^https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"*_]/.exec(rest);
      if (m) {
        flush();
        out.push(renderLink({ kind: "external", href: m[0] }, m[0], key(), ctx));
        i += m[0].length;
        continue;
      }
    }
    // Strong / emphasis / strike
    if (c === "*" || c === "_" || c === "~") {
      const dbl = s[i + 1] === c;
      const prev = i > 0 ? s[i - 1] : " ";
      // Intraword underscores stay literal (snake_case).
      if (c === "_" && /\w/.test(prev)) {
        buf += c;
        i++;
        continue;
      }
      if (c === "~" && !dbl) {
        buf += c;
        i++;
        continue;
      }
      const marker = dbl ? c + c : c;
      const after = s[i + marker.length];
      if (after && !/\s/.test(after)) {
        let j = i + marker.length;
        let end = -1;
        while ((j = s.indexOf(marker, j)) !== -1) {
          const before = s[j - 1];
          const next = s[j + marker.length];
          const partOfDouble = !dbl && (s[j + 1] === c || s[j - 1] === c);
          if (!/\s/.test(before) && j > i + marker.length && !partOfDouble && !(c === "_" && next && /\w/.test(next))) {
            end = j;
            break;
          }
          j += marker.length;
        }
        if (end !== -1) {
          flush();
          const inner = inline(s.slice(i + marker.length, end), ctx, `${keyBase}-e${k}`);
          if (c === "~") out.push(<del key={key()}>{inner}</del>);
          else if (dbl) out.push(<strong key={key()}>{inner}</strong>);
          else out.push(<em key={key()}>{inner}</em>);
          i = end + marker.length;
          continue;
        }
      }
      buf += marker;
      i += marker.length;
      continue;
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

// ─── Render ──────────────────────────────────────────────────────────

export function CodeBlock({ text, lang, compact }: { text: string; lang?: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={compact ? "skmd-pre skmd-pre-compact" : "skmd-pre"}>
      <div className="skmd-pre-bar">
        <span>{lang || "text"}</span>
        <button
          type="button"
          onClick={async () => {
            if (await copyText(text)) {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1400);
            }
          }}
          aria-label="Copy code"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code>{text}</code>
      </pre>
    </div>
  );
}

function renderBlocks(blocks: Block[], ctx: Ctx, tight = false, prefix = "b"): ReactNode[] {
  return blocks.map((b, n) => {
    const key = `${prefix}${n}`;
    switch (b.t) {
      case "h": {
        const Tag = `h${Math.min(6, b.depth)}` as "h2";
        return (
          <Tag key={key} id={b.id} className={`skmd-h skmd-h${b.depth}`}>
            {inline(b.text, ctx, key)}
          </Tag>
        );
      }
      case "p":
        return tight ? (
          // A span, not a Fragment: Replit's dev plugin adds attributes to every JSX element, which Fragments reject.
          <span key={key}>{inline(b.text, ctx, key)}</span>
        ) : (
          <p key={key} className="skmd-p">
            {inline(b.text, ctx, key)}
          </p>
        );
      case "code":
        return <CodeBlock key={key} text={b.text} lang={b.lang} />;
      case "hr":
        return <hr key={key} className="skmd-hr" />;
      case "quote":
        return (
          <blockquote key={key} className="skmd-quote">
            {renderBlocks(b.blocks, ctx, false, `${key}q`)}
          </blockquote>
        );
      case "table":
        return (
          <div key={key} className="skmd-table-wrap">
            <table className="skmd-table">
              <thead>
                <tr>
                  {b.head.map((c, ci) => (
                    <th key={ci} style={b.align[ci] ? { textAlign: b.align[ci] } : undefined}>
                      {inline(c, ctx, `${key}h${ci}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, ri) => (
                  <tr key={ri}>
                    {b.head.map((_, ci) => (
                      <td key={ci} style={b.align[ci] ? { textAlign: b.align[ci] } : undefined}>
                        {inline(r[ci] ?? "", ctx, `${key}r${ri}c${ci}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case "list": {
        const ListTag = b.ordered ? "ol" : "ul";
        const isTight = b.items.every((it) => it.blocks.filter((x) => x.t === "p").length <= 1);
        return (
          <ListTag key={key} className={b.ordered ? "skmd-ol" : "skmd-ul"} start={b.ordered && b.start !== 1 ? b.start : undefined}>
            {b.items.map((it, ii) => (
              <li key={ii} className={it.task !== null ? "skmd-task" : undefined}>
                {it.task !== null && (
                  <span className={it.task ? "skmd-check skmd-check-on" : "skmd-check"} aria-hidden="true">
                    {it.task ? "✓" : ""}
                  </span>
                )}
                {it.task !== null ? <span className="sr-only">{it.task ? "Done: " : "To do: "}</span> : null}
                <div className="skmd-li">{renderBlocks(it.blocks, ctx, isTight, `${key}i${ii}-`)}</div>
              </li>
            ))}
          </ListTag>
        );
      }
    }
  });
}

/** Parses once per text and renders. `skipTitle` drops a leading # heading (the page header already shows it). */
export function Markdown({ text, resolve, onFile, skipTitle = false, className }: { text: string; resolve: (href: string) => LinkTarget; onFile?: (path: string) => void; skipTitle?: boolean; className?: string }) {
  const blocks = useMemo(() => {
    const parsed = parseBlocks(text.replace(/\r\n?/g, "\n").split("\n"), new Map());
    return skipTitle && parsed[0]?.t === "h" && parsed[0].depth === 1 ? parsed.slice(1) : parsed;
  }, [text, skipTitle]);
  return <div className={className ? `skmd ${className}` : "skmd"}>{renderBlocks(blocks, { resolve, onFile })}</div>;
}

/** Headings (## and ###) for an on-page table of contents. */
export function outline(text: string): { depth: number; text: string; id: string }[] {
  const blocks = parseBlocks(text.replace(/\r\n?/g, "\n").split("\n"), new Map());
  const out: { depth: number; text: string; id: string }[] = [];
  const walk = (bs: Block[]) => {
    for (const b of bs) {
      if (b.t === "h" && (b.depth === 2 || b.depth === 3)) out.push({ depth: b.depth, text: b.text.replace(/[`*_]/g, ""), id: b.id });
      else if (b.t === "quote") walk(b.blocks);
    }
  };
  walk(blocks);
  return out;
}

/**
 * Link resolver for a file inside a skill. `file` is the path of the file being shown (e.g. "SKILL.md" or
 * "references/x.md"); links are resolved the way a filesystem would: skills/<category>/<slug>/<dir of file>/<href>.
 */
export function skillResolver(category: string, slug: string, file: string, files: Set<string>): (href: string) => LinkTarget {
  return (href) => {
    const h = href.trim();
    if (/^https?:\/\//i.test(h)) return { kind: "external", href: h };
    if (/^mailto:/i.test(h)) return { kind: "external", href: h };
    if (h.startsWith("#")) return { kind: "anchor", id: h.slice(1) };
    if (/^[a-z][a-z0-9+.-]*:/i.test(h) || h.startsWith("//")) return { kind: "none" };
    if (h.startsWith("/")) return { kind: "route", href: h };
    const [pathPart] = h.split("#");
    const dir = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";
    const parts = ["skills", category, slug, ...(dir ? dir.split("/") : [])];
    for (const seg of decodeURIComponent(pathPart).split("/")) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") parts.pop();
      else parts.push(seg);
    }
    if (parts[0] !== "skills" || parts.length < 4) return { kind: "none" };
    const [, , s, ...restParts] = parts;
    const rest = restParts.join("/");
    if (s === slug && parts[1] === category) {
      if (!rest || rest === "SKILL.md") return { kind: "route", href: `/skills/${slug}` };
      return files.has(rest) ? { kind: "file", path: rest } : { kind: "none" };
    }
    if (!/^[a-z0-9-]+$/.test(s)) return { kind: "none" };
    if (!rest || rest === "SKILL.md") return { kind: "route", href: `/skills/${s}` };
    return { kind: "route", href: `/skills/${s}?file=${encodeURIComponent(rest)}` };
  };
}
