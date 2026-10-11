// ASCII-art coin image generator: text → low-res glyph mask → character grid → 1024² PNG.
// Pure canvas, no fonts to download (uses the system monospace stack).

export type AsciiPalette = "claudio" | "matrix" | "gold" | "mono" | "sunset";
export type AsciiCharset = "blocks" | "classic" | "binary" | "dots";

export const ASCII_PALETTES: Record<AsciiPalette, { bg: string; stops: string[]; label: string }> = {
  claudio: { bg: "#0e0d0c", stops: ["#ff6a2b", "#ffb04a"], label: "Claudio" },
  matrix: { bg: "#020a04", stops: ["#1aff6a", "#0b7a34"], label: "Matrix" },
  gold: { bg: "#0d0a03", stops: ["#ffd35c", "#ff9f1c"], label: "Gold" },
  mono: { bg: "#0b0b0c", stops: ["#f5f5f5", "#8a8a8a"], label: "Mono" },
  sunset: { bg: "#0f0512", stops: ["#ff5c7a", "#9b6bff"], label: "Sunset" },
};

const CHARSETS: Record<AsciiCharset, string> = {
  blocks: " ░▒▓█",
  classic: " .:-=+*#%@",
  binary: " 01",
  dots: " ·•●",
};

export interface AsciiOptions {
  text: string;
  palette: AsciiPalette;
  charset: AsciiCharset;
  /** Grid columns (detail). */
  cols: number;
  /** Fill empty cells with faint noise glyphs. */
  noise: boolean;
}

export const DEFAULT_ASCII: AsciiOptions = { text: "", palette: "claudio", charset: "classic", cols: 56, noise: true };

const SIZE = 1024;
const MONO = 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace';

/** Renders into `out` (resized to 1024²). Deterministic for the same options (seeded noise). */
export function renderAscii(out: HTMLCanvasElement, opts: AsciiOptions): void {
  out.width = SIZE;
  out.height = SIZE;
  const ctx = out.getContext("2d");
  if (!ctx) return;
  const pal = ASCII_PALETTES[opts.palette] ?? ASCII_PALETTES.claudio;
  const chars = CHARSETS[opts.charset];
  const cols = Math.max(16, Math.min(96, Math.round(opts.cols)));
  const cell = SIZE / cols;
  const rows = cols;

  // 1) Rasterize the text into a cols×rows mask (chars are ~0.6 wide, so scale x accordingly).
  const mask = document.createElement("canvas");
  mask.width = cols;
  mask.height = rows;
  const m = mask.getContext("2d", { willReadFrequently: true });
  if (!m) return;
  m.fillStyle = "#000";
  m.fillRect(0, 0, cols, rows);
  const lines = (opts.text.trim() || "CLAUDIO").toUpperCase().split(/\n+/).slice(0, 4);
  m.fillStyle = "#fff";
  m.textAlign = "center";
  m.textBaseline = "middle";
  const longest = Math.max(...lines.map((l) => l.length), 1);
  let fontPx = Math.min((rows * 0.8) / lines.length, (cols * 1.55) / longest);
  fontPx = Math.max(4, fontPx);
  m.font = `900 ${fontPx}px ${MONO}`;
  const lineH = fontPx * 1.02;
  const top = rows / 2 - ((lines.length - 1) * lineH) / 2;
  lines.forEach((l, i) => m.fillText(l, cols / 2, top + i * lineH, cols * 0.96));
  const px = m.getImageData(0, 0, cols, rows).data;

  // 2) Background + subtle vignette.
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, SIZE, SIZE);
  const vg = ctx.createRadialGradient(SIZE / 2, SIZE / 2, SIZE * 0.1, SIZE / 2, SIZE / 2, SIZE * 0.75);
  vg.addColorStop(0, "rgba(255,255,255,0.04)");
  vg.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // 3) Glyph grid with a diagonal gradient.
  const grad = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  pal.stops.forEach((c, i) => grad.addColorStop(pal.stops.length === 1 ? 0 : i / (pal.stops.length - 1), c));
  ctx.font = `700 ${cell * 1.05}px ${MONO}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let seed = 0;
  for (let i = 0; i < opts.text.length; i++) seed = (seed * 31 + opts.text.charCodeAt(i)) >>> 0;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const v = px[(y * cols + x) * 4] / 255;
      const cx = x * cell + cell / 2;
      const cy = y * cell + cell / 2;
      if (v > 0.08) {
        const ch = chars[Math.min(chars.length - 1, Math.max(1, Math.round(v * (chars.length - 1))))];
        ctx.globalAlpha = 0.55 + v * 0.45;
        ctx.fillStyle = grad;
        ctx.fillText(ch, cx, cy);
      } else if (opts.noise && rand() < 0.16) {
        ctx.globalAlpha = 0.1 + rand() * 0.12;
        ctx.fillStyle = pal.stops[pal.stops.length - 1];
        ctx.fillText(chars[1 + Math.floor(rand() * (chars.length - 1))], cx, cy);
      }
    }
  }
  ctx.globalAlpha = 1;
}

export function asciiToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG export failed"))), "image/png"));
}
