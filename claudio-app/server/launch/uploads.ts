// Image + metadata storage. Pinata (IPFS, public network) when PINATA_JWT is set; otherwise ./uploads served by
// this server (dev/testnet only — refused on mainnet in production; pump.fun/indexers need a permanent public URL).
//
// Pinata v3 (docs.pinata.cloud/api-reference/endpoint/upload-a-file, checked 2026-09-27):
//   POST https://uploads.pinata.cloud/v3/files, Authorization: Bearer <JWT>, multipart `file` + `network=public`
//   → { data: { id, cid, name, size, mime_type, … } }
import { promises as fs } from "fs";
import path from "path";
import { nanoid } from "nanoid";
import { IS_TESTNET } from "../network";
import { launchEnv } from "./env";
import { LaunchError } from "./types";

/** Mainnet production never serves coin files from this server: they'd be written on-chain and break later. */
function assertCanStoreLocally(): void {
  if (!IS_TESTNET && process.env.NODE_ENV === "production") {
    throw new LaunchError(503, "pinning_required", "Image/metadata pinning isn't configured (PINATA_JWT), so coins can't be launched on mainnet right now.");
  }
}

export const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
/** Filenames we generate: nanoid + known extension. Anything else is rejected before touching the disk. */
export const SAFE_UPLOAD_NAME = /^[A-Za-z0-9_-]{10,40}\.(png|jpg|gif|webp|json)$/;

export type ImageKind = "png" | "jpg" | "gif" | "webp";
export const IMAGE_MIME: Record<ImageKind, string> = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

/** Identify an image by magic bytes (never trust the client's mimetype). */
export function sniffImage(buf: Buffer): ImageKind | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return "png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  const head6 = buf.subarray(0, 6).toString("ascii");
  if (head6 === "GIF87a" || head6 === "GIF89a") return "gif";
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  return null;
}

export interface StoredFile {
  /** What goes on-chain / into metadata: ipfs://<cid> (Pinata) or an absolute http(s) URL (dev). */
  uri: string;
  /** Browser-loadable URL. */
  url: string;
  cid?: string;
  dev: boolean;
}

async function pinToPinata(jwt: string, data: Buffer, filename: string, mime: string): Promise<StoredFile> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(data)], { type: mime }), filename);
  form.append("network", "public");
  form.append("name", filename);
  const res = await fetch("https://uploads.pinata.cloud/v3/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Pinata upload failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { data?: { cid?: string } };
  const cid = json.data?.cid;
  if (!cid) throw new Error("Pinata response missing data.cid");
  return { uri: `ipfs://${cid}`, url: `https://${launchEnv.pinataGateway()}/ipfs/${cid}`, cid, dev: false };
}

async function saveLocal(data: Buffer, ext: string, baseUrl: string): Promise<StoredFile> {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const name = `${nanoid(21)}.${ext}`;
  await fs.writeFile(path.join(UPLOAD_DIR, name), data);
  const url = `${baseUrl}/uploads/${name}`;
  return { uri: url, url, dev: true };
}

export async function storeImage(data: Buffer, kind: ImageKind, baseUrl: string): Promise<StoredFile> {
  const jwt = launchEnv.pinataJwt();
  if (jwt) return pinToPinata(jwt, data, `claudio-${nanoid(8)}.${kind}`, IMAGE_MIME[kind]);
  assertCanStoreLocally();
  return saveLocal(data, kind, baseUrl);
}

export async function storeJson(obj: unknown, baseUrl: string): Promise<StoredFile> {
  const data = Buffer.from(JSON.stringify(obj), "utf8");
  const jwt = launchEnv.pinataJwt();
  if (jwt) return pinToPinata(jwt, data, `claudio-meta-${nanoid(8)}.json`, "application/json");
  assertCanStoreLocally();
  return saveLocal(data, "json", baseUrl);
}
