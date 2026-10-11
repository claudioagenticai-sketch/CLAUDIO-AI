// A small streaming multipart/form-data reader for exactly one file field (named "file" by default).
// Written by hand so /relay/media controls every byte: it hashes the raw body for request signatures, enforces the
// size cap itself, and can stop instantly on abort (no library stream left waiting on a half-sent body).
//
//   const mp = new SingleFileMultipart(boundaryFrom(contentType)!);
//   for (const chunk of body) for (const piece of mp.push(chunk)) write(piece);   // file bytes only
//   const err = mp.end();                                                          // null when complete
//
// push() throws MultipartError on malformed input.

export class MultipartError extends Error {}

export function boundaryFrom(contentType: string): string | null {
  const m = /;\s*boundary=(?:"([^"]{1,70})"|([^\s;]{1,70}))/i.exec(contentType);
  return m ? (m[1] ?? m[2]) : null;
}

type State = "preamble" | "after_delim" | "headers" | "body" | "done";

const MAX_HEADER_BYTES = 8 * 1024;
const MAX_PARTS = 10;

export class SingleFileMultipart {
  private readonly delim: Buffer;
  private buf: Buffer;
  private state: State = "preamble";
  private inFile = false;
  private parts = 0;
  /** True once the file part has started. */
  sawFile = false;
  filename: string | null = null;

  constructor(boundary: string, private readonly field = "file") {
    this.delim = Buffer.from(`\r\n--${boundary}`, "latin1");
    // The body opens with "--boundary" (no CRLF); pretend it had one so every delimiter looks the same.
    this.buf = Buffer.from("\r\n", "latin1");
  }

  push(chunk: Buffer): Buffer[] {
    const out: Buffer[] = [];
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      if (this.state === "done") {
        this.buf = Buffer.alloc(0); // epilogue is ignored
        return out;
      }
      if (this.state === "preamble" || this.state === "body") {
        const i = this.buf.indexOf(this.delim);
        if (i === -1) {
          // Keep enough tail to catch a delimiter split across chunks.
          const keep = Math.min(this.buf.length, this.delim.length - 1);
          const emit = this.buf.subarray(0, this.buf.length - keep);
          if (this.state === "body" && this.inFile && emit.length) out.push(Buffer.from(emit));
          this.buf = Buffer.from(this.buf.subarray(this.buf.length - keep));
          if (this.state === "preamble" && this.buf.length > MAX_HEADER_BYTES) throw new MultipartError("No multipart boundary found");
          return out;
        }
        if (this.state === "body" && this.inFile && i > 0) out.push(Buffer.from(this.buf.subarray(0, i)));
        this.buf = this.buf.subarray(i + this.delim.length);
        this.inFile = false;
        this.state = "after_delim";
        continue;
      }
      if (this.state === "after_delim") {
        if (this.buf.length < 2) return out;
        const two = this.buf.subarray(0, 2).toString("latin1");
        if (two === "--") {
          this.state = "done";
          continue;
        }
        // Transport padding (spaces/tabs) is allowed before the CRLF.
        const eol = this.buf.indexOf("\r\n");
        if (eol === -1) {
          if (this.buf.length > 256) throw new MultipartError("Malformed multipart delimiter");
          return out;
        }
        if (this.buf.subarray(0, eol).toString("latin1").trim() !== "") throw new MultipartError("Malformed multipart delimiter");
        this.buf = this.buf.subarray(eol + 2);
        this.state = "headers";
        continue;
      }
      if (this.state === "headers") {
        const end = this.buf.indexOf("\r\n\r\n");
        if (end === -1) {
          if (this.buf.length > MAX_HEADER_BYTES) throw new MultipartError("Multipart part headers are too large");
          return out;
        }
        const head = this.buf.subarray(0, end).toString("utf8");
        this.buf = this.buf.subarray(end + 4);
        if (++this.parts > MAX_PARTS) throw new MultipartError("Too many multipart parts");
        const disp = head.split("\r\n").find((l) => /^content-disposition\s*:/i.test(l)) ?? "";
        const name = /;\s*name="([^"]*)"/i.exec(disp)?.[1] ?? /;\s*name=([^\s;]+)/i.exec(disp)?.[1] ?? null;
        if (name === this.field) {
          if (this.sawFile) throw new MultipartError(`Only one "${this.field}" per upload`);
          this.sawFile = true;
          this.inFile = true;
          this.filename = /;\s*filename="([^"]*)"/i.exec(disp)?.[1] ?? null;
        }
        this.state = "body";
        continue;
      }
    }
  }

  /** Call when the request body ends. Returns an error message, or null when a complete file part was read. */
  end(): string | null {
    if (this.state !== "done") return "The multipart body ended early";
    if (!this.sawFile) return `No "${this.field}" field in the upload`;
    return null;
  }
}
