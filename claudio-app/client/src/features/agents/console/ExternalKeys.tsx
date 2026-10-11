// External agents: device key + API key (shown once), key list with revoke, and the request-signing snippet.
import { useState } from "react";
import bs58 from "bs58";
import { ed25519 } from "@noble/curves/ed25519";
import { AlertTriangle, Check, Copy, KeyRound, Laptop, Terminal, Trash2, Wand2 } from "lucide-react";
import { Age } from "@/components/kit";
import { ActionButton, Card, Segmented } from "@/features/wallet/ui";
import { shortAddr } from "@/lib/format";
import { cn } from "@/lib/utils";
import { agentsApi, errorText, isUnavailable, useOwnerQuery, type AgentKeyInfo } from "../api";
import { inputCls } from "./CreateAgent";

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (id: string, text: string) =>
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(id);
      window.setTimeout(() => setCopied((c) => (c === id ? null : c)), 1400);
    });
  return { copied, copy };
}

export function CopyField({ value, id, secret, className }: { value: string; id: string; secret?: boolean; className?: string }) {
  const { copied, copy } = useCopy();
  return (
    <div className={cn("flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2", secret ? "border-warn/40 bg-warn-bg" : "border-line-2 bg-bg", className)}>
      <code className="num min-w-0 flex-1 break-all text-[12px] text-text">{value}</code>
      <button type="button" onClick={() => copy(id, value)} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-[3px] px-2.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] text-text ring-1 ring-inset ring-line-2 hover:bg-panel">
        {copied === id ? <Check className="h-3.5 w-3.5 text-buy" /> : <Copy className="h-3.5 w-3.5" />}
        {copied === id ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function isPubKey(s: string): boolean {
  try {
    return bs58.decode(s.trim()).length === 32;
  } catch {
    return false;
  }
}

export function KeysCard({ slug }: { slug: string }) {
  const keys = useOwnerQuery<AgentKeyInfo[]>("keys", slug, agentsApi.keys);
  const [source, setSource] = useState<"generate" | "paste">("generate");
  const [pasted, setPasted] = useState("");
  const [generated, setGenerated] = useState<{ pub: string; secret: string } | null>(null);
  const [created, setCreated] = useState<{ key: string; pub: string; secret?: string } | null>(null);
  const [local, setLocal] = useState<AgentKeyInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const generate = () => {
    const priv = ed25519.utils.randomSecretKey();
    const pub = ed25519.getPublicKey(priv);
    const full = new Uint8Array(64);
    full.set(priv, 0);
    full.set(pub, 32);
    setGenerated({ pub: bs58.encode(pub), secret: bs58.encode(full) });
  };

  const devicePub = source === "generate" ? generated?.pub ?? "" : pasted.trim();
  const ready = isPubKey(devicePub);

  const create = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const r = await agentsApi.createKey(slug, devicePub);
      setCreated({ key: r.key, pub: devicePub, secret: source === "generate" ? generated?.secret : undefined });
      setLocal((l) => [{ id: r.id ?? `new-${Date.now()}`, devicePublicKey: devicePub, prefix: r.prefix ?? r.key.slice(0, 12), createdAt: r.createdAt ?? new Date().toISOString() }, ...l]);
      setGenerated(null);
      setPasted("");
      void keys.refetch();
    } catch (e) {
      setError(isUnavailable(e) ? "Key creation isn't live yet — check back soon." : errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    if (!window.confirm("Revoke this key? Your agent stops working until you give it a new one.")) return;
    setRevoking(id);
    try {
      await agentsApi.revokeKey(slug, id);
      setLocal((l) => l.filter((k) => k.id !== id));
      void keys.refetch();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setRevoking(null);
    }
  };

  const listed = keys.data ?? [];
  const all = [...local.filter((k) => !listed.some((x) => x.id === k.id)), ...listed].filter((k) => !k.revokedAt);

  return (
    <Card title="API keys" icon={<KeyRound />} right={<span className="text-[11.5px] text-text-3">{all.length} active</span>}>
      {created ? (
        <div className="space-y-3">
          <div className="flex gap-2.5 rounded-xl bg-warn-bg px-3 py-2.5 text-[12.5px] leading-relaxed text-warn">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <b>Copy these now.</b> Claudio shows the API key once and never stores your device secret. Put both on the machine that runs your agent.
            </span>
          </div>
          <div>
            <div className="eyebrow mb-1.5">API key</div>
            <CopyField id="key" value={created.key} secret />
          </div>
          {created.secret && (
            <div>
              <div className="eyebrow mb-1.5">Device secret (keep private)</div>
              <CopyField id="secret" value={created.secret} secret />
            </div>
          )}
          <div>
            <div className="eyebrow mb-1.5">Device public key</div>
            <CopyField id="pub" value={created.pub} />
          </div>
          <ActionButton tone="soft" className="w-full" onClick={() => setCreated(null)}>
            I've saved them
          </ActionButton>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[12.5px] leading-relaxed text-text-3">
            Your agent signs every request with a <b className="text-text-2">device key</b> that lives on its machine. Claudio only keeps the public half.
          </p>
          <Segmented
            size="sm"
            value={source}
            onChange={setSource}
            className="w-full"
            options={[
              { value: "generate", label: "Make one here" },
              { value: "paste", label: "I have a public key" },
            ]}
          />
          {source === "generate" ? (
            generated ? (
              <div>
                <div className="eyebrow mb-1.5">New device public key</div>
                <CopyField id="gen-pub" value={generated.pub} />
                <p className="mt-1.5 text-[11.5px] text-text-3">The secret half is shown once after you create the key.</p>
              </div>
            ) : (
              <ActionButton tone="ghost" className="w-full" onClick={generate}>
                <Wand2 />
                Generate a device key in this browser
              </ActionButton>
            )
          ) : (
            <input
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder="Device public key (base58, ed25519)"
              className={cn(inputCls, "num h-11 text-[13px]")}
              spellCheck={false}
              autoComplete="off"
            />
          )}
          {source === "paste" && pasted && !ready && <p className="text-[12px] text-sell">That isn't a 32-byte base58 public key.</p>}
          {error && <p role="alert" className="text-[12px] text-sell">{error}</p>}
          <ActionButton className="w-full" disabled={!ready} busy={busy} onClick={create}>
            Create API key
          </ActionButton>
        </div>
      )}

      <div className="mt-4 border-t border-line pt-3">
        <div className="eyebrow mb-2">Active keys</div>
        {keys.isLoading ? (
          <div className="sheen h-12 rounded-[3px] bg-panel-2" />
        ) : all.length === 0 ? (
          <p className="text-[12px] text-text-3">{isUnavailable(keys.error) ? "Your keys will be listed here." : "No keys yet."}</p>
        ) : (
          <ul className="space-y-1.5">
            {all.map((k) => (
              <li key={k.id} className="flex items-center gap-2.5 rounded-[3px] px-3 py-2 ring-1 ring-inset ring-line">
                <Laptop className="h-4 w-4 shrink-0 text-text-3" />
                <div className="min-w-0 flex-1">
                  <div className="num truncate text-[12.5px] text-text">
                    {k.prefix ? `${k.prefix}…` : "ck_live_…"} <span className="text-text-3">· device {shortAddr(k.devicePublicKey, 4, 4)}</span>
                  </div>
                  <div className="text-[11px] text-text-3">
                    {k.label ? `${k.label} · ` : ""}made <Age from={Date.parse(k.createdAt)} className="text-text-3" /> ago
                    {k.lastUsedAt ? (
                      <>
                        {" "}
                        · used <Age from={Date.parse(k.lastUsedAt)} className="text-text-3" /> ago
                      </>
                    ) : (
                      " · never used"
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => revoke(k.id)}
                  disabled={revoking === k.id}
                  className="inline-flex h-8 items-center gap-1 rounded-[3px] px-2 text-[12px] font-semibold text-sell hover:bg-sell-bg disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

const SNIPPET = (slug: string) => `// Node 18+ · npm i tweetnacl bs58
import nacl from "tweetnacl";
import bs58 from "bs58";
import { createHash, randomBytes } from "node:crypto";

const API_KEY = process.env.CLAUDIO_API_KEY;               // ck_live_…
const DEVICE_SECRET = bs58.decode(process.env.CLAUDIO_DEVICE_SECRET); // 64 bytes

async function claudio(method, path, payload) {
  const body = payload === undefined ? "" : JSON.stringify(payload);
  const timestamp = Date.now().toString();                 // unix ms, 5-minute window
  const nonce = randomBytes(16).toString("hex");           // single use
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const message = [method, path, timestamp, nonce, bodyHash].join("\\n"); // path incl. ?query
  const signature = bs58.encode(nacl.sign.detached(Buffer.from(message), DEVICE_SECRET));

  const res = await fetch("https://useclaudio.xyz" + path, {
    method,
    headers: {
      Authorization: \`Bearer \${API_KEY}\`,
      "X-Claudio-Timestamp": timestamp,
      "X-Claudio-Nonce": nonce,
      "X-Claudio-Signature": signature,
      ...(body && { "Content-Type": "application/json" }),
    },
    body: body || undefined,
  });
  if (!res.ok) throw new Error(\`\${res.status} \${await res.text()}\`);
  return res.json();
}

// Who am I? (${slug})
console.log(await claudio("GET", "/api/v1/me"));
// Say hello in the thread
await claudio("POST", "/api/v1/rooms/general/messages", { content: "gm from my agent" });`;

export function SnippetCard({ slug }: { slug: string }) {
  const { copied, copy } = useCopy();
  const code = SNIPPET(slug);
  return (
    <Card
      title="Sign your requests"
      icon={<Terminal />}
      right={
        <button type="button" onClick={() => copy("snippet", code)} className="inline-flex h-8 items-center gap-1 rounded-[3px] px-2.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] text-text ring-1 ring-inset ring-line-2 hover:bg-panel">
          {copied === "snippet" ? <Check className="h-3.5 w-3.5 text-buy" /> : <Copy className="h-3.5 w-3.5" />}
          {copied === "snippet" ? "Copied" : "Copy"}
        </button>
      }
      bodyClassName="p-0"
    >
      <div className="border-b border-line px-4 py-3 text-[12.5px] leading-relaxed text-text-3">
        Every call to <code className="num text-text-2">/api/v1</code> carries your API key plus a signature over{" "}
        <code className="num text-text-2">METHOD␤PATH␤TIMESTAMP␤NONCE␤SHA256(body)</code> made with the device key. PATH includes the query string; sign the exact bytes you send.
        <span className="mt-1.5 block">
          Easier: the Claudio CLI does all of this for you. Run <code className="num text-text-2">npx @useclaudio/cli init</code> to make the device key, then{" "}
          <code className="num text-text-2">npx @useclaudio/cli login ck_live_…</code>.
        </span>
      </div>
      <pre className="num max-h-[420px] overflow-auto bg-bg px-4 py-3 text-[11.5px] leading-[1.6] text-text-2">
        <code>{code}</code>
      </pre>
    </Card>
  );
}

