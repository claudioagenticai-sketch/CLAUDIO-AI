import { useEffect, useState } from "react";
import { Bell, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/store";
import { ResponsiveSheet } from "@/components/kit";
import { kindOfAddress } from "@/lib/wallet/keys";
import { ActionButton, Toggle, kindName } from "@/features/wallet/ui";
import { TRACKER_EMOJIS, useTracker } from "./store";

export function AddWalletSheet({ open, onOpenChange, initialAddress }: { open: boolean; onOpenChange: (o: boolean) => void; initialAddress?: string }) {
  const add = useTracker((s) => s.add);
  const update = useTracker((s) => s.update);
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [emoji, setEmoji] = useState(TRACKER_EMOJIS[0]);
  const [alerts, setAlerts] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setAddress(initialAddress ?? "");
      setLabel("");
      setErr(null);
      setEmoji(TRACKER_EMOJIS[Math.floor(Math.random() * TRACKER_EMOJIS.length)]);
    }
  }, [open, initialAddress]);

  const kind = kindOfAddress(address.trim());

  const submit = () => {
    try {
      const w = add({ address, label, emoji });
      if (alerts) update(w.address, { alerts: true });
      haptic(12);
      onOpenChange(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't add wallet");
    }
  };

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange} title="Track a wallet" description="Follow any public address — whales, KOLs, devs, your other wallets.">
      <div className="grid gap-3 pb-2">
        <div>
          <label className="eyebrow mb-1.5 block">Address</label>
          <input
            value={address}
            onChange={(e) => {
              setAddress(e.target.value);
              setErr(null);
            }}
            placeholder="Solana or 0x… address"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            className={cn(
              "num h-12 w-full rounded-xl border bg-bg px-3.5 text-base outline-none transition-colors focus:border-brand focus:ring-1 focus:ring-brand md:text-sm",
              err ? "border-sell" : "border-line-2",
            )}
          />
          <div className="mt-1 min-h-[18px] text-xs">
            {err ? (
              <span className="text-sell">{err}</span>
            ) : kind ? (
              <span className="inline-flex items-center gap-1 text-buy">
                <Check className="h-3.5 w-3.5" /> {kindName(kind)} address
              </span>
            ) : address.trim() ? (
              <span className="text-text-3">Not a valid address yet</span>
            ) : null}
          </div>
        </div>
        <div>
          <label className="eyebrow mb-1.5 block">Label</label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={24}
            placeholder="e.g. Cupsey, dev of $FROG"
            className="h-11 w-full rounded-[3px] border border-line-2 bg-bg px-3.5 text-base outline-none transition-colors focus:border-brand focus:ring-1 focus:ring-brand md:text-sm"
          />
        </div>
        <div>
          <div className="eyebrow mb-1.5">Emoji</div>
          <div className="grid grid-cols-8 gap-1.5">
            {TRACKER_EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setEmoji(e)}
                className={cn(
                  "flex h-10 items-center justify-center rounded-[3px] text-lg transition",
                  emoji === e ? "bg-brand-bg ring-1 ring-brand" : "ring-1 ring-inset ring-line hover:bg-panel-2",
                )}
                aria-label={`Emoji ${e}`}
                aria-pressed={emoji === e}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
        <div className="rounded-[3px] px-3 ring-1 ring-inset ring-line">
          <Toggle checked={alerts} onChange={setAlerts} icon={<Bell />} label="Trade alerts" hint="Toast when this wallet buys or sells a token Claudio is indexing." />
        </div>
        <ActionButton className="h-12 w-full" disabled={!kind} onClick={submit}>
          <span className="text-base">{emoji}</span> Track wallet
        </ActionButton>
      </div>
    </ResponsiveSheet>
  );
}
