// Files tab: the agent's small text-file workspace (stored by Claudio, never on your device or the server's disk).
// A folder tree on the left, a plain-text editor on the right; on phones the editor replaces the tree.
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import type { CloudWorkspace, FileEntry } from "@shared/cloud";
import { Age } from "@/components/kit";
import { toast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { ActionButton } from "@/features/wallet/ui";
import { errorText } from "@/features/agents/api";
import { cn } from "@/lib/utils";
import { cloudApi, useFiles, useInvalidateCloud } from "./api";

const kb = (b: number) => (b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(b < 10_240 ? 1 : 0)} KB` : `${(b / 1048576).toFixed(b % 1048576 ? 1 : 0)} MB`);

function groupByFolder(files: FileEntry[]): [string, FileEntry[]][] {
  const m = new Map<string, FileEntry[]>();
  for (const f of files) {
    const i = f.path.lastIndexOf("/");
    const dir = i <= 0 ? "/" : f.path.slice(0, i);
    m.set(dir, [...(m.get(dir) ?? []), f]);
  }
  return [...m.entries()].sort(([a], [b]) => (a === "/" ? -1 : b === "/" ? 1 : a.localeCompare(b)));
}

export function FilesTab({ ws }: { ws: CloudWorkspace }) {
  const slug = ws.agent.slug;
  const owner = ws.role === "owner";
  const mobile = useIsMobile();
  const files = useFiles(slug);
  const invalidate = useInvalidateCloud();
  const [open, setOpen] = useState<string | null>(null); // path, or "" for a new file
  const [path, setPath] = useState("");
  const [content, setContent] = useState("");
  const [saved, setSaved] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open === null || open === "") return;
    let live = true;
    setLoading(true);
    cloudApi
      .file(slug, open)
      .then((r) => {
        if (!live) return;
        setPath(r.file.path);
        setContent(r.file.content);
        setSaved(r.file.content);
      })
      .catch((e) => toast({ title: "Couldn't open that file", description: errorText(e), variant: "destructive" }))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [open, slug]);

  const groups = useMemo(() => groupByFolder(files.data?.files ?? []), [files.data]);
  const quota = files.data?.quota;
  const dirty = open === "" ? content.length > 0 || path.length > 0 : content !== saved;

  const startNew = () => {
    setOpen("");
    setPath("/notes/");
    setContent("");
    setSaved("");
  };

  const save = async () => {
    setBusy(true);
    try {
      const r = await cloudApi.writeFile(slug, path.trim(), content);
      setSaved(content);
      setOpen(r.file.path);
      setPath(r.file.path);
      invalidate(slug, "files");
      toast({ title: `Saved ${r.file.path}` });
    } catch (e) {
      toast({ title: "Couldn't save", description: errorText(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!open) return;
    if (!window.confirm(`Delete ${open}?`)) return;
    try {
      await cloudApi.deleteFile(slug, open);
      setOpen(null);
      invalidate(slug, "files");
    } catch (e) {
      toast({ title: "Couldn't delete", description: errorText(e), variant: "destructive" });
    }
  };

  const tree = (
    <section className="panel flex min-h-0 flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <span className="text-[13.5px] font-bold">Files</span>
        {owner && (
          <button type="button" onClick={startNew} className="inline-flex h-8 items-center gap-1 rounded-[3px] border border-line-2 px-2.5 text-[12px] font-bold text-text-2 hover:border-text-3 hover:text-text">
            <Plus className="h-3.5 w-3.5" />
            New file
          </button>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {files.isLoading ? (
          <div className="sheen h-32 rounded-xl bg-panel-2" />
        ) : files.error ? (
          <p className="p-2 text-[12.5px] text-text-3">{errorText(files.error)}</p>
        ) : !groups.length ? (
          <p className="p-3 text-[12.5px] leading-relaxed text-text-3">No files yet. Make one here, or ask the agent to write notes into a file.</p>
        ) : (
          groups.map(([dir, list]) => (
            <div key={dir} className="mb-2">
              <div className="num px-2 py-1 text-[11px] text-text-3">{dir}</div>
              <ul>
                {list.map((f) => (
                  <li key={f.path}>
                    <button
                      type="button"
                      onClick={() => setOpen(f.path)}
                      className={cn("flex w-full items-center gap-2 rounded-[3px] px-2 py-1.5 text-left", f.path === open ? "bg-panel-3 text-text" : "text-text-2 hover:bg-panel-2")}
                    >
                      <span className="num min-w-0 flex-1 truncate pl-2 text-[12.5px]">{f.path.slice(f.path.lastIndexOf("/") + 1)}</span>
                      <span className="num shrink-0 text-[10.5px] text-text-3">{kb(f.size)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
      {quota && (
        <footer className="border-t border-line px-4 py-2.5 text-[11px] text-text-3">
          <div className="mb-1 h-1 overflow-hidden bg-line">
            <div className="h-full bg-text-3" style={{ width: `${Math.min(100, (quota.usedBytes / quota.maxTotalBytes) * 100)}%` }} />
          </div>
          <span className="num">{kb(quota.usedBytes)}</span> of <span className="num">{kb(quota.maxTotalBytes)}</span> · {files.data!.files.length} of {quota.maxFiles} files · text only, up to{" "}
          {kb(quota.maxFileBytes)} each
        </footer>
      )}
    </section>
  );

  const current = files.data?.files.find((f) => f.path === open);
  const editor =
    open === null ? (
      <section className="panel hidden min-h-[320px] items-center justify-center p-6 text-center text-[13px] text-text-3 md:flex">Pick a file to read or edit it.</section>
    ) : (
      <section className="panel flex min-h-0 min-w-0 flex-col">
        <header className="flex items-center gap-2 border-b border-line px-3 py-2.5">
          {mobile && (
            <button type="button" aria-label="Back to files" onClick={() => setOpen(null)} className="inline-flex h-9 w-9 items-center justify-center rounded-[3px] text-text-2 hover:bg-panel-3">
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          {open === "" ? (
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/notes/plan.md"
              aria-label="File path"
              className="num h-9 min-w-0 flex-1 rounded-[3px] border border-line-2 bg-bg-elev px-2.5 text-[12.5px] text-text outline-none focus:border-brand"
            />
          ) : (
            <span className="num min-w-0 flex-1 truncate text-[12.5px] font-semibold">{open}</span>
          )}
          {current && (
            <span className="hidden shrink-0 text-[11px] text-text-3 sm:inline">
              edited <Age from={Date.parse(current.updatedAt)} className="text-text-3" /> ago
            </span>
          )}
          {owner && open !== "" && (
            <button type="button" aria-label="Delete file" onClick={remove} className="inline-flex h-9 w-9 items-center justify-center rounded-[3px] text-text-3 hover:bg-panel-3 hover:text-sell">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </header>
        {loading ? (
          <div className="sheen m-3 h-48 rounded-xl bg-panel-2" />
        ) : (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            readOnly={!owner}
            spellCheck={false}
            placeholder="Plain text, Markdown, JSON or CSV"
            className="num min-h-[300px] flex-1 resize-none bg-transparent p-3.5 text-[12.5px] leading-relaxed text-text outline-none placeholder:text-text-3 md:min-h-[420px]"
          />
        )}
        {owner && (
          <footer className="flex items-center justify-between gap-2 border-t border-line px-3 py-2.5">
            <span className="text-[11px] text-text-3">{open === "" ? "Use .md, .txt, .json, .csv or .yaml" : dirty ? "Unsaved changes" : "Saved"}</span>
            <ActionButton busy={busy} disabled={!dirty || !path.trim()} onClick={save}>
              Save
            </ActionButton>
          </footer>
        )}
      </section>
    );

  if (mobile) return open === null ? tree : editor;
  return <div className="grid min-h-0 items-start gap-4 md:grid-cols-[280px_minmax(0,1fr)]">{tree}{editor}</div>;
}
