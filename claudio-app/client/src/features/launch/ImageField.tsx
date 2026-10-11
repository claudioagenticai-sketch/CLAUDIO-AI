// Coin image: drag & drop, paste, file picker, URL, library of recent uploads and an ASCII-art generator.
import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactElement } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ClipboardPaste, ImagePlus, Library, Link2, Loader2, Sparkles, Terminal, Trash2, Upload } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { launchApi } from "./api";
import { ASCII_PALETTES, DEFAULT_ASCII, asciiToBlob, renderAscii, type AsciiCharset, type AsciiOptions, type AsciiPalette } from "./ascii";
import type { DraftImage } from "./draft";
import { ACCEPTED_TYPES, fetchImageBlob, imageFromTransfer, prepareImage } from "./image";
import { Callout, Segmented, TextInput } from "./ui";

type Tab = "upload" | "url" | "ascii" | "library";

export function ImageField({
  image,
  onChange,
  library,
  onUploaded,
  asciiSeed,
  compact = false,
}: {
  image?: DraftImage;
  onChange: (img: DraftImage | undefined) => void;
  library: DraftImage[];
  onUploaded: (img: DraftImage) => void;
  /** Default ASCII text (the ticker). */
  asciiSeed: string;
  compact?: boolean;
}) {
  const [tab, setTab] = useState<Tab>("upload");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = useCallback(
    async (file: Blob) => {
      setError(null);
      setBusy(true);
      const preview = URL.createObjectURL(file);
      setLocalPreview(preview);
      try {
        const { blob, filename } = await prepareImage(file);
        const res = await launchApi.uploadImage(blob, filename);
        const img: DraftImage = { uri: res.uri, url: res.url, dev: res.dev };
        onChange(img);
        onUploaded(img);
        setTab("upload");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setBusy(false);
        setLocalPreview(null);
        URL.revokeObjectURL(preview);
      }
    },
    [onChange, onUploaded],
  );

  // Paste an image anywhere on the page (text pastes into inputs are left alone).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = imageFromTransfer(e.clipboardData);
      if (!file) return;
      e.preventDefault();
      void upload(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [upload]);

  const readClipboard = async () => {
    setError(null);
    try {
      const clip = navigator.clipboard;
      if (!clip || typeof clip.read !== "function") throw new Error("Press Ctrl/⌘+V to paste an image");
      const items = await clip.read();
      for (const it of items) {
        const type = it.types.find((t) => t.startsWith("image/"));
        if (type) {
          await upload(await it.getType(type));
          return;
        }
      }
      setError("No image on the clipboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Clipboard unavailable — press Ctrl/⌘+V");
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const f = imageFromTransfer(e.dataTransfer);
    if (f) void upload(f);
    else setError("Drop an image file");
  };

  const shown = localPreview ?? image?.url;

  return (
    <div className={cn("flex gap-4", compact ? "flex-col" : "flex-col sm:flex-row")}>
      {/* Preview / drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !busy && fileRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") fileRef.current?.click();
        }}
        aria-label="Upload coin image"
        className={cn(
          "group relative mx-auto aspect-square w-36 shrink-0 cursor-pointer overflow-hidden rounded-[22%] border-[1.5px] border-dashed outline-none transition-all focus-visible:ring-2 focus-visible:ring-brand sm:mx-0 sm:w-[152px]",
          dragging ? "scale-[1.02] border-brand bg-brand-bg" : shown ? "border-transparent ring-1 ring-line-2" : "border-line-2 bg-bg-elev bg-grid hover:border-brand/60",
        )}
      >
        {shown ? (
          <img src={shown} alt="Coin" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 px-4 text-center">
            <span className="flex h-10 w-10 items-center justify-center text-text-3 transition-colors group-hover:text-brand">
              <ImagePlus className="h-5 w-5" />
            </span>
            <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] text-text-2">Drop, paste or tap</span>
            <span className="num text-[10px] leading-tight text-text-3">PNG · JPG · GIF · WEBP
              <br />≤ 4MB</span>
          </div>
        )}
        <AnimatePresence>
          {busy && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex items-center justify-center bg-bg/60 backdrop-blur-[2px]"
            >
              <Loader2 className="h-6 w-6 animate-spin text-brand" />
            </motion.div>
          )}
        </AnimatePresence>
        {image && !busy && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange(undefined);
            }}
            className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-[4px] bg-bg/80 text-text opacity-100 backdrop-blur transition-opacity hover:bg-sell hover:text-sell-ink md:opacity-0 md:group-hover:opacity-100"
            aria-label="Remove image"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPTED_TYPES.join(",")}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
            e.target.value = "";
          }}
        />
      </div>

      {/* Sources */}
      <div className="min-w-0 flex-1">
        <div className="mb-3 flex gap-1 overflow-x-auto rounded-[3px] border border-line-2 p-[3px] no-scrollbar">
          <TabBtn active={tab === "upload"} onClick={() => setTab("upload")} icon={<Upload />} label="Upload" />
          <TabBtn active={tab === "url"} onClick={() => setTab("url")} icon={<Link2 />} label="URL" />
          <TabBtn active={tab === "ascii"} onClick={() => setTab("ascii")} icon={<Terminal />} label="ASCII" />
          <TabBtn active={tab === "library"} onClick={() => setTab("library")} icon={<Library />} label={`Library${library.length ? ` ${library.length}` : ""}`} />
          <TabBtn active={false} disabled onClick={() => undefined} icon={<Sparkles />} label="AI · soon" />
        </div>

        {tab === "upload" && (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="btn btn-secondary h-11 md:h-10">
              <Upload className="h-4 w-4" /> Choose file
            </button>
            <button type="button" onClick={readClipboard} disabled={busy} className="btn btn-secondary h-11 md:h-10">
              <ClipboardPaste className="h-4 w-4" /> Paste
            </button>
            <p className="col-span-2 text-[11.5px] leading-snug text-text-3">
              Square images work best. Non-square images are center-cropped; GIFs keep their animation.
            </p>
          </div>
        )}
        {tab === "url" && <UrlSource busy={busy} onBlob={upload} onDirect={(img) => onChange(img)} />}
        {tab === "ascii" && <AsciiStudio seed={asciiSeed} busy={busy} onUse={upload} />}
        {tab === "library" && (
          <div>
            {library.length === 0 ? (
              <p className="py-3 text-[12px] text-text-3">Images you upload show up here for reuse.</p>
            ) : (
              <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-6">
                {library.map((img) => (
                  <button
                    key={img.url}
                    type="button"
                    onClick={() => onChange(img)}
                    className={cn(
                      "aspect-square overflow-hidden rounded-[22%] border-2 transition-all",
                      image?.url === img.url ? "border-brand" : "border-transparent hover:border-line-2",
                    )}
                  >
                    <img src={img.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {error && (
          <Callout tone="bad" icon={<AlertTriangle />} className="mt-2">
            {error}
          </Callout>
        )}
        {image?.dev && (
          <Callout tone="warn" icon={<AlertTriangle />} className="mt-2">
            <b>Dev storage.</b> This image is served by this server, not IPFS — explorers and other terminals may not
            load it. Configure Pinata before launching for real.
          </Callout>
        )}
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, icon, label, disabled }: { active: boolean; onClick: () => void; icon: ReactElement; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-8 shrink-0 items-center gap-1.5 rounded-[2px] px-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.08em] transition-colors [&>svg]:h-3.5 [&>svg]:w-3.5",
        active ? "bg-panel-3 text-text [&>svg]:text-brand" : "text-text-3 hover:text-text-2",
        disabled && "cursor-not-allowed opacity-40 hover:text-text-3",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function UrlSource({ busy, onBlob, onDirect }: { busy: boolean; onBlob: (b: Blob) => Promise<void>; onDirect: (img: DraftImage) => void }) {
  const [url, setUrl] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const valid = /^https:\/\/\S+$/i.test(url.trim()) || /^ipfs:\/\/\S+$/i.test(url.trim());
  const go = async () => {
    const u = url.trim();
    setNote(null);
    if (u.startsWith("ipfs://")) {
      onDirect({ uri: u, url: `https://ipfs.io/ipfs/${u.slice(7)}`, dev: false });
      return;
    }
    const blob = await fetchImageBlob(u);
    if (blob) {
      await onBlob(blob);
    } else {
      onDirect({ uri: u, url: u, dev: false });
      setNote("That site blocks downloads, so the image is hot-linked instead of pinned. It breaks if the host removes it.");
    }
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <TextInput value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… or ipfs://…" inputMode="url" className="flex-1" />
        <button type="button" disabled={!valid || busy} onClick={go} className="btn btn-secondary h-11 shrink-0 px-5 md:h-10">
          Use
        </button>
      </div>
      {note && <Callout tone="warn">{note}</Callout>}
    </div>
  );
}

function AsciiStudio({ seed, busy, onUse }: { seed: string; busy: boolean; onUse: (b: Blob) => Promise<void> }) {
  const [opts, setOpts] = useState<AsciiOptions>({ ...DEFAULT_ASCII, text: seed || "CLAUDIO" });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const edited = useRef(false);

  useEffect(() => {
    if (!edited.current && seed) setOpts((o) => ({ ...o, text: seed }));
  }, [seed]);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (canvasRef.current) renderAscii(canvasRef.current, opts);
    });
    return () => cancelAnimationFrame(id);
  }, [opts]);

  const set = (p: Partial<AsciiOptions>) => setOpts((o) => ({ ...o, ...p }));

  return (
    <div className="space-y-2.5">
      <div className="flex gap-3">
        <canvas ref={canvasRef} className="aspect-square w-24 shrink-0 rounded-[22%] border border-line sm:w-28" style={{ imageRendering: "auto" }} />
        <div className="min-w-0 flex-1 space-y-2">
          <textarea
            value={opts.text}
            onChange={(e) => {
              edited.current = true;
              set({ text: e.target.value.slice(0, 40) });
            }}
            rows={2}
            placeholder="Type text (new line = new row)"
            className="w-full resize-none rounded-[3px] border border-line-2 bg-bg px-3 py-2 font-mono text-[14px] uppercase text-text outline-none transition-[border-color,box-shadow] focus:border-brand focus:ring-1 focus:ring-brand md:text-[13px]"
          />
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(ASCII_PALETTES) as AsciiPalette[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => set({ palette: p })}
                title={ASCII_PALETTES[p].label}
                aria-label={`${ASCII_PALETTES[p].label} palette`}
                className={cn("h-8 w-8 rounded-[4px] border-2 transition-transform", opts.palette === p ? "scale-105 border-text" : "border-transparent")}
                style={{ background: `linear-gradient(135deg, ${ASCII_PALETTES[p].stops.join(", ")})` }}
              />
            ))}
          </div>
        </div>
      </div>
      <Segmented
        layoutId="ascii-charset"
        size="sm"
        value={opts.charset}
        onChange={(charset) => set({ charset })}
        options={[
          { value: "classic", label: "@#*:." },
          { value: "blocks", label: "█▓▒░" },
          { value: "binary", label: "0101" },
          { value: "dots", label: "●•·" },
        ]}
      />
      <div className="flex items-center gap-3">
        <span className="w-12 text-[11px] text-text-3">Detail</span>
        <Slider value={[opts.cols]} min={24} max={96} step={4} onValueChange={(v) => set({ cols: v[0] ?? opts.cols })} className="flex-1" />
        <label className="flex items-center gap-1.5 text-[11px] text-text-3">
          Noise
          <Switch checked={opts.noise} onCheckedChange={(noise) => set({ noise })} />
        </label>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          if (!canvasRef.current) return;
          renderAscii(canvasRef.current, opts);
          await onUse(await asciiToBlob(canvasRef.current));
        }}
        className="btn btn-primary h-11 w-full md:h-10"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Terminal className="h-4 w-4" />} Use ASCII art
      </button>
    </div>
  );
}
