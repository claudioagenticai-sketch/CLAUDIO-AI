// Image helpers: square crop + resize in the browser before upload (GIFs pass through to keep animation).
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MAX_EDGE = 1024;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read that image"));
    img.src = src;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Image encoding failed"))), type, quality);
  });
}

/** Center-crop to a square and cap the edge at 1024px. Returns the processed blob + a filename. */
export async function prepareImage(file: Blob): Promise<{ blob: Blob; filename: string }> {
  const type = ACCEPTED_TYPES.includes(file.type) ? file.type : "";
  if (!type) throw new Error("Use a PNG, JPEG, GIF or WEBP image");
  if (type === "image/gif") {
    if (file.size > MAX_UPLOAD_BYTES) throw new Error("GIFs must be 4 MB or smaller");
    return { blob: file, filename: "image.gif" };
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const edge = Math.min(side, MAX_EDGE);
    const canvas = document.createElement("canvas");
    canvas.width = edge;
    canvas.height = edge;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    const sx = (img.naturalWidth - side) / 2;
    const sy = (img.naturalHeight - side) / 2;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, sx, sy, side, side, 0, 0, edge, edge);
    const outType = type === "image/png" ? "image/png" : type === "image/webp" ? "image/webp" : "image/jpeg";
    let blob = await canvasToBlob(canvas, outType, 0.92);
    if (blob.size > MAX_UPLOAD_BYTES) blob = await canvasToBlob(canvas, "image/jpeg", 0.85);
    if (blob.size > MAX_UPLOAD_BYTES) throw new Error("Image is too large even after compression");
    const ext = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
    return { blob, filename: `image.${ext}` };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** First image found in a paste event / DataTransfer. */
export function imageFromTransfer(dt: DataTransfer | null): File | null {
  if (!dt) return null;
  for (let i = 0; i < dt.items.length; i++) {
    const it = dt.items[i];
    if (it.kind === "file" && it.type.startsWith("image/")) {
      const f = it.getAsFile();
      if (f) return f;
    }
  }
  for (let i = 0; i < dt.files.length; i++) {
    if (dt.files[i].type.startsWith("image/")) return dt.files[i];
  }
  return null;
}

/** Fetch a remote image in the browser (CORS permitting). Returns null when blocked. */
export async function fetchImageBlob(url: string): Promise<Blob | null> {
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) return null;
    const blob = await res.blob();
    return blob.type.startsWith("image/") ? blob : null;
  } catch {
    return null;
  }
}
