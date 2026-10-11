// A wallet in a table row: X name (KOLs) or short address, tag icons, tool chips. Click opens the wallet sheet.
import type { WalletIdentity } from "@shared/insights";
import { cn } from "@/lib/utils";
import { shortWallet } from "./format";
import { openWallet } from "./WalletSheet";
import { ToolChips, WalletTags } from "./WalletTags";

export function WalletCell({
  w,
  you,
  maxTags = 4,
  tools = true,
  className,
}: {
  w: Pick<WalletIdentity, "address" | "name" | "tags" | "tools" | "twitter">;
  you?: boolean;
  maxTags?: number;
  tools?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5", className)}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          openWallet(w.address, w);
        }}
        className={cn("min-w-0 truncate text-left hover:text-text", w.name ? "font-semibold text-text" : "num text-text-2")}
        title={w.name ? `${w.name} · ${w.address}` : w.address}
      >
        {w.name ?? shortWallet(w.address)}
      </button>
      {you && <span className="chip chip-brand shrink-0 px-1 py-[2px] text-[9px]">You</span>}
      <WalletTags tags={w.tags} max={maxTags} />
      {tools && <ToolChips tools={w.tools} max={1} className="hidden sm:inline-flex" />}
    </span>
  );
}
