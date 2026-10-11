// /relay/media — short-lived public links for networks that pull media from a URL (Instagram, Threads, TikTok
// pull-from-URL, some posting services). Claudio Local / the CLI uploads a finished image or video, gets a URL,
// hands it to the network, and the file disappears on its own after the TTL.
//
//   POST   /relay/media[?ttl=<minutes 1–60, default 15>]   multipart field "file", or the raw bytes with Content-Type
//   GET    /relay/media/<id>.<ext>                         public (the id is 24 random url-safe chars); Range supported
//   DELETE /relay/media/<id>.<ext>                         same credential as the upload
//
// Auth: see ./auth.ts (verifyRelayToken). Limits: 200 MB per file; jpeg/png/webp/gif/mp4/mov only, decided by the
// file's magic bytes (the Content-Type header is never trusted on its own); 30 uploads/hour per token; 2 GB on
// disk in total. Files live in a temp dir under os.tmpdir(), are swept every minute, and are wiped on restart.
// There are no database rows: the index is in memory, so a restart simply expires everything early.
//
// Env (all optional): RELAY_MEDIA_DIR, RELAY_MEDIA_MAX_BYTES, RELAY_MEDIA_TOTAL_BYTES, RELAY_MEDIA_PER_HOUR,
// RELAY_MEDIA_SWEEP_MS, and RELAY_MEDIA_TTL_MS_OVERRIDE (testing only: forces every TTL to this many ms).
import type { Express, Request, Response } from "express";
import { createHash, randomBytes } from "crypto";
import { createWriteStream, mkdirSync, promises as fsp, rmSync } from "fs";
import os from "os";
import path from "path";
import { BRAND } from "@shared/brand";
import { hit } from "../auth";
import { log } from "../vite";
import { verifyRelayToken, type RelayCheck, type RelayDenied, type RelayPrincipal } from "./auth";
import { MultipartError, SingleFileMultipart, boundaryFrom } from "./multipart";

const envNum = (name: string, def: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : def;
};

const MAX_BYTES = envNum("RELAY_MEDIA_MAX_BYTES", 200 * 1024 * 1024);
const TOTAL_BYTES = envNum("RELAY_MEDIA_TOTAL_BYTES", 2 * 1024 * 1024 * 1024);
const PER_HOUR = envNum("RELAY_MEDIA_PER_HOUR", 30);
const SWEEP_MS = envNum("RELAY_MEDIA_SWEEP_MS", 60_000);
const TTL_OVERRIDE_MS = envNum("RELAY_MEDIA_TTL_MS_OVERRIDE", 0);
const DEFAULT_TTL_MIN = 15;
const MAX_TTL_MIN = 60;
/** Multipart framing + a few small fields on top of the file itself. */
const MULTIPART_SLACK = 256 * 1024;
const MAX_INFLIGHT_PER_TOKEN = 2;
const DIR = path.resolve(process.env.RELAY_MEDIA_DIR?.trim() || path.join(os.tmpdir(), "claudio-relay-media"));

export const RELAY_MEDIA_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
} as const;
type Mime = keyof typeof RELAY_MEDIA_TYPES;
type Ext = (typeof RELAY_MEDIA_TYPES)[Mime];

const NAME_RE = /^([A-Za-z0-9_-]{24})\.(jpg|png|webp|gif|mp4|mov)$/;

interface Entry {
  id: string;
  ext: Ext;
  mime: Mime;
  bytes: number;
  file: string;
  owner: string;
  createdAt: number;
  expiresAt: number;
}

const files = new Map<string, Entry>();
let diskBytes = 0;
let reservedBytes = 0;
const uploadsByToken = new Map<string, number[]>();
const inflight = new Map<string, number>();

function baseUrl(): string {
  const b = (process.env.CLAUDIO_BASE_URL ?? "").trim().replace(/\/+$/, "");
  return /^https?:\/\/[^\s/]+(\/[^\s]*)?$/.test(b) ? b : BRAND.site;
}

// ─── magic bytes ─────────────────────────────────────────────────────

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** ISO-BMFF major brands that are ordinary MP4 video. HEIC/AVIF/M4A brands are deliberately absent. */
const MP4_BRANDS = new Set(["isom", "iso2", "iso3", "iso4", "iso5", "iso6", "mp41", "mp42", "mp71", "avc1", "M4V ", "M4VH", "M4VP", "dash", "mmp4", "MSNV", "NDAS", "XAVC", "f4v "]);

export function sniffMedia(b: Buffer): Mime | null {
  const a = (s: number, e: number) => b.subarray(s, e).toString("latin1");
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b.subarray(0, 8).equals(PNG)) return "image/png";
  if (b.length >= 6 && (a(0, 6) === "GIF87a" || a(0, 6) === "GIF89a")) return "image/gif";
  if (b.length >= 12 && a(0, 4) === "RIFF" && a(8, 12) === "WEBP") return "image/webp";
  if (b.length >= 12 && a(4, 8) === "ftyp") {
    const brand = a(8, 12);
    if (brand === "qt  ") return "video/quicktime";
    if (MP4_BRANDS.has(brand)) return "video/mp4";
    return null;
  }
  // Old QuickTime files can start straight with a moov/wide atom.
  if (b.length >= 8 && (a(4, 8) === "moov" || a(4, 8) === "wide")) return "video/quicktime";
  return null;
}

async function head(file: string, n = 32): Promise<Buffer> {
  const fh = await fsp.open(file, "r");
  try {
    const buf = Buffer.alloc(n);
    const { bytesRead } = await fh.read(buf, 0, n, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

// ─── bookkeeping ─────────────────────────────────────────────────────

function recentUploads(id: string, now: number): number[] {
  const list = (uploadsByToken.get(id) ?? []).filter((t) => now - t < 3600_000);
  if (list.length) uploadsByToken.set(id, list);
  else uploadsByToken.delete(id);
  return list;
}

async function removeEntry(e: Entry): Promise<void> {
  if (!files.delete(e.id)) return;
  diskBytes = Math.max(0, diskBytes - e.bytes);
  await fsp.unlink(e.file).catch(() => {});
}

async function sweep(): Promise<void> {
  const now = Date.now();
  for (const e of [...files.values()]) if (e.expiresAt <= now) await removeEntry(e);
  // Orphans (a crash mid-upload): anything on disk we don't know about and older than the max TTL.
  try {
    const known = new Set([...files.values()].map((e) => path.basename(e.file)));
    for (const name of await fsp.readdir(DIR)) {
      if (known.has(name)) continue;
      const p = path.join(DIR, name);
      const st = await fsp.stat(p).catch(() => null);
      if (st && now - st.mtimeMs > (MAX_TTL_MIN + 5) * 60_000) await fsp.unlink(p).catch(() => {});
    }
  } catch {
    /* dir missing: recreated on next upload */
  }
  for (const [k] of uploadsByToken) recentUploads(k, now);
}

let sweeper: NodeJS.Timeout | null = null;
function startSweeper(): void {
  if (sweeper) return;
  // Fresh start: the index lives in memory, so anything left from a previous process is unreachable — wipe it.
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  sweeper = setInterval(() => void sweep().catch(() => {}), SWEEP_MS);
  sweeper.unref();
}

// ─── helpers ─────────────────────────────────────────────────────────

const send = (res: Response, d: RelayDenied | { status: number; error: string; message: string; [k: string]: unknown }) => {
  if (res.headersSent) return;
  const { ok: _ok, status, ...body } = d as RelayDenied;
  res.status(status).json(body);
};

function parseTtlMin(raw: unknown): number | null {
  if (raw === undefined || raw === "") return DEFAULT_TTL_MIN;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_TTL_MIN) return null;
  return n;
}

const EMPTY_SHA = createHash("sha256").update("").digest("hex");

function noStore(res: Response) {
  res.set("Cache-Control", "no-store");
  res.set("X-Content-Type-Options", "nosniff");
}

// ─── routes ──────────────────────────────────────────────────────────

export function registerRelayMediaRoutes(app: Express): void {
  startSweeper();

  const tmpName = () => `up-${randomBytes(12).toString("hex")}.part`;

  app.post("/relay/media", async (req: Request, res: Response) => {
    noStore(res);
    const ip = req.ip ?? "?";
    let tmp: string | null = null;
    let reserved = 0;
    let principal: RelayPrincipal | null = null;
    // Until the body has been read, any early answer also closes the connection (don't wait for a big body).
    let bodyRead = false;
    const cleanup = async () => {
      reservedBytes = Math.max(0, reservedBytes - reserved);
      reserved = 0;
      if (principal) inflight.set(principal.id, Math.max(0, (inflight.get(principal.id) ?? 1) - 1));
      principal = null;
      if (tmp) await fsp.unlink(tmp).catch(() => {});
      tmp = null;
    };
    const fail = async (status: number, error: string, message: string, extra: Record<string, unknown> = {}) => {
      await cleanup();
      if (!bodyRead && !res.headersSent) res.set("Connection", "close");
      if (!res.headersSent) res.status(status).json({ error, message, ...extra });
    };

    try {
      if (!hit(`relay-media-ip:${ip}`, 120, 3600_000)) return fail(429, "rate_limited", "Too many uploads from this address");

      const ttlMin = parseTtlMin(req.query.ttl);
      if (ttlMin === null) return fail(400, "bad_ttl", `ttl is whole minutes from 1 to ${MAX_TTL_MIN}`);

      const ctype = String(req.headers["content-type"] ?? "").toLowerCase();
      const multipart = ctype.startsWith("multipart/form-data");
      const rawType = ctype.split(";")[0].trim();
      if (!multipart && !(rawType in RELAY_MEDIA_TYPES) && rawType !== "application/octet-stream") {
        return fail(415, "unsupported_type", "Send multipart/form-data with a \"file\" field, or the raw bytes as image/jpeg, image/png, image/webp, image/gif, video/mp4 or video/quicktime");
      }

      const auth: RelayCheck = await verifyRelayToken(req);
      if (!auth.ok) {
        res.set("Connection", "close");
        return send(res, auth);
      }
      const who = auth.principal;

      const now = Date.now();
      const recent = recentUploads(who.id, now);
      if (recent.length >= PER_HOUR) {
        const retry = Math.max(1, Math.ceil((recent[0] + 3600_000 - now) / 1000));
        res.set("Retry-After", String(retry));
        return fail(429, "rate_limited", `Upload limit reached (${PER_HOUR} per hour per token)`, { retryAfterSec: retry });
      }
      if ((inflight.get(who.id) ?? 0) >= MAX_INFLIGHT_PER_TOKEN) return fail(429, "too_many_uploads", `At most ${MAX_INFLIGHT_PER_TOKEN} uploads at a time per token`);
      inflight.set(who.id, (inflight.get(who.id) ?? 0) + 1);
      principal = who;

      const cap = MAX_BYTES + (multipart ? MULTIPART_SLACK : 0);
      const declared = Number(req.headers["content-length"]);
      if (Number.isFinite(declared) && declared > cap) {
        res.set("Connection", "close");
        return fail(413, "too_large", `Files can be at most ${Math.round(MAX_BYTES / 1024 / 1024)} MB`);
      }
      reserved = Number.isFinite(declared) && declared > 0 ? declared : cap;
      if (diskBytes + reservedBytes + reserved > TOTAL_BYTES) {
        res.set("Retry-After", "120");
        return fail(507, "storage_full", "The media relay is full right now. Try again in a few minutes, or use a shorter ttl.");
      }
      reservedBytes += reserved;

      // Read the body by hand: hash the exact raw bytes (the agent-key signature covers SHA-256 of the body), pull the
      // file out of multipart on the fly, respect disk backpressure, and stop at the cap — never drain an endless body.
      const boundary = multipart ? boundaryFrom(ctype) : null;
      if (multipart && !boundary) return fail(400, "bad_multipart", "multipart/form-data needs a boundary");
      const parser = boundary ? new SingleFileMultipart(boundary) : null;
      const hash = createHash("sha256");
      tmp = path.join(DIR, tmpName());
      const file = tmp;
      const sink = createWriteStream(file, { flags: "wx", mode: 0o600 });
      let seen = 0;
      let fileBytes = 0;
      const outcome = await new Promise<"ok" | "too_big" | "aborted" | { bad: string }>((resolve) => {
        let settled = false;
        const end = (v: "ok" | "too_big" | "aborted" | { bad: string }) => {
          if (settled) return;
          settled = true;
          resolve(v);
        };
        req.on("data", (chunk: Buffer) => {
          if (settled) return;
          seen += chunk.length;
          if (seen > cap) return end("too_big");
          hash.update(chunk);
          let pieces: Buffer[];
          try {
            pieces = parser ? parser.push(chunk) : [chunk];
          } catch (e) {
            return end({ bad: e instanceof MultipartError ? e.message : "Couldn't read the multipart body" });
          }
          for (const p of pieces) {
            fileBytes += p.length;
            if (fileBytes > MAX_BYTES) return end("too_big");
            if (!sink.write(p)) {
              req.pause();
              sink.once("drain", () => req.resume());
            }
          }
        });
        req.on("end", () => {
          if (settled) return;
          const err = parser?.end();
          if (err) return end({ bad: err });
          sink.end(() => end("ok"));
        });
        req.on("close", () => {
          if (!req.complete) end("aborted");
        });
        req.on("error", () => end("aborted"));
        sink.on("error", () => end({ bad: "Couldn't store the upload" }));
      });
      bodyRead = outcome === "ok";
      if (outcome !== "ok") {
        sink.destroy();
        res.set("Connection", "close");
        res.once("finish", () => req.destroy());
        if (outcome === "too_big") return fail(413, "too_large", `Files can be at most ${Math.round(MAX_BYTES / 1024 / 1024)} MB`);
        if (outcome === "aborted") return fail(400, "upload_aborted", "The upload didn't finish");
        return fail(400, "bad_multipart", outcome.bad);
      }

      const bodyHash = hash.digest("hex");
      if (auth.finish) {
        const denied = await auth.finish(bodyHash);
        if (denied) {
          await cleanup();
          return send(res, denied);
        }
      }

      const st = await fsp.stat(file);
      if (st.size === 0) return fail(400, "empty", "The file is empty");
      if (st.size > MAX_BYTES) return fail(413, "too_large", `Files can be at most ${Math.round(MAX_BYTES / 1024 / 1024)} MB`);
      const mime = sniffMedia(await head(file));
      if (!mime) return fail(415, "unsupported_type", "Only JPEG, PNG, WebP, GIF, MP4 and MOV files can be relayed (checked from the file's contents)");
      if (diskBytes + st.size > TOTAL_BYTES) {
        res.set("Retry-After", "120");
        return fail(507, "storage_full", "The media relay is full right now. Try again in a few minutes.");
      }

      const id = randomBytes(18).toString("base64url");
      const ext = RELAY_MEDIA_TYPES[mime];
      const final = path.join(DIR, `${id}.${ext}`);
      await fsp.rename(file, final);
      tmp = null;
      const createdAt = Date.now();
      const expiresAt = createdAt + (TTL_OVERRIDE_MS || ttlMin * 60_000);
      files.set(id, { id, ext, mime, bytes: st.size, file: final, owner: who.id, createdAt, expiresAt });
      diskBytes += st.size;
      uploadsByToken.set(who.id, [...recentUploads(who.id, createdAt), createdAt]);
      await cleanup();
      res.status(201).json({ id, url: `${baseUrl()}/relay/media/${id}.${ext}`, expiresAt, bytes: st.size, mime });
    } catch (e) {
      log(`relay media upload failed: ${(e as Error).message}`, "relay");
      await fail(500, "internal", "Upload failed");
    }
  });

  app.get("/relay/media/:name", (req: Request, res: Response) => {
    const m = NAME_RE.exec(String(req.params.name));
    const e = m ? files.get(m[1]) : undefined;
    const now = Date.now();
    if (!m || !e || e.ext !== m[2] || e.expiresAt <= now) {
      noStore(res);
      return res.status(404).json({ error: "not_found", message: "This link has expired or never existed" });
    }
    const maxAge = Math.max(0, Math.floor((e.expiresAt - now) / 1000));
    res.set({
      "Content-Type": e.mime,
      "Cache-Control": `private, max-age=${maxAge}`,
      Expires: new Date(e.expiresAt).toUTCString(),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": `inline; filename="${e.id}.${e.ext}"`,
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
    });
    res.sendFile(e.file, { cacheControl: false, lastModified: false, etag: true, acceptRanges: true, dotfiles: "allow" }, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: "not_found", message: "This link has expired" });
    });
  });

  app.delete("/relay/media/:name", async (req: Request, res: Response) => {
    noStore(res);
    try {
      const auth = await verifyRelayToken(req);
      if (!auth.ok) return send(res, auth);
      if (auth.finish) {
        const denied = await auth.finish(EMPTY_SHA);
        if (denied) return send(res, denied);
      }
      const m = NAME_RE.exec(String(req.params.name));
      const e = m ? files.get(m[1]) : undefined;
      if (!m || !e || e.ext !== m[2]) return res.status(404).json({ error: "not_found", message: "No such file (it may have expired already)" });
      if (e.owner !== auth.principal.id) return res.status(403).json({ error: "not_owner", message: "Only the token that uploaded a file can delete it" });
      await removeEntry(e);
      res.json({ ok: true, id: e.id });
    } catch (err) {
      log(`relay media delete failed: ${(err as Error).message}`, "relay");
      if (!res.headersSent) res.status(500).json({ error: "internal", message: "Delete failed" });
    }
  });

  app.all("/relay/media", (_req, res) => {
    noStore(res);
    res.set("Allow", "POST").status(405).json({ error: "method_not_allowed", message: "POST a file here; GET /relay/media/<id>.<ext> to fetch one" });
  });
}

/** For ops/health views: how full the relay is. */
export function relayMediaStats() {
  return { files: files.size, diskBytes, reservedBytes, totalBytes: TOTAL_BYTES };
}
