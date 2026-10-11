// QR code + mobile deep links for a pending WalletConnect pairing.
import { useMemo } from "react";
import { renderSVG } from "uqr";
import { Copy, Smartphone } from "lucide-react";
import { ResponsiveSheet } from "@/components/kit";
import { toast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { cancelWalletConnect, useWcModal } from "@/lib/wallet/walletconnect";
import { ActionButton } from "./ui";

/** Universal links for popular WalletConnect wallets (the plain wc: URI works as a fallback on most phones). */
const MOBILE_WALLETS: { name: string; link: (uri: string) => string }[] = [
  { name: "MetaMask", link: (u) => `https://metamask.app.link/wc?uri=${encodeURIComponent(u)}` },
  { name: "Trust", link: (u) => `https://link.trustwallet.com/wc?uri=${encodeURIComponent(u)}` },
  { name: "Rainbow", link: (u) => `https://rnbwapp.com/wc?uri=${encodeURIComponent(u)}` },
  { name: "OKX", link: (u) => `okx://main/wc?uri=${encodeURIComponent(u)}` },
];

export function WalletConnectModal() {
  const { open, uri } = useWcModal();
  const mobile = useIsMobile();
  const svg = useMemo(() => (uri ? renderSVG(uri, { border: 1, ecc: "M", pixelSize: 6, whiteColor: "#ffffff", blackColor: "#0d0c0b" }) : ""), [uri]);
  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={(o) => !o && cancelWalletConnect()}
      title="Connect a mobile wallet"
      description="Scan with any WalletConnect wallet. One connection covers Solana, plus Robinhood Chain and BNB Chain when they open."
    >
      <div className="grid gap-3 pb-2">
        <div className="relative mx-auto w-full max-w-[296px] p-2">
          {/* corner brackets frame the code like a viewfinder */}
          {["left-0 top-0 border-l-2 border-t-2 rounded-tl-xl", "right-0 top-0 border-r-2 border-t-2 rounded-tr-xl", "bottom-0 left-0 border-b-2 border-l-2 rounded-bl-xl", "bottom-0 right-0 border-b-2 border-r-2 rounded-br-xl"].map((c) => (
            <span key={c} className={`pointer-events-none absolute h-7 w-7 border-brand ${c}`} aria-hidden />
          ))}
          {uri ? (
            <div
              className="w-full overflow-hidden rounded-[3px] bg-white p-2 [&>svg]:h-auto [&>svg]:w-full"
              data-testid="wc-qr"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ) : (
            <div className="aspect-square w-full rounded-[3px] border border-line sheen" />
          )}
        </div>
        <p className="text-center text-xs text-text-3">{uri ? "Open your wallet app → scan → approve." : "Preparing a secure pairing…"}</p>
        {uri && (
          <>
            {mobile && (
              <div className="grid grid-cols-2 gap-2">
                {MOBILE_WALLETS.map((w) => (
                  <a
                    key={w.name}
                    href={w.link(uri)}
                    className="btn btn-secondary h-11"
                  >
                    <Smartphone className="h-4 w-4 text-text-3" /> {w.name}
                  </a>
                ))}
                <a href={uri} className="col-span-2 inline-flex h-11 items-center justify-center rounded-[3px] border border-dashed border-line-2 text-sm text-text-2">
                  Other wallet app
                </a>
              </div>
            )}
            <ActionButton
              tone="ghost"
              onClick={() => {
                void navigator.clipboard?.writeText(uri);
                toast({ title: "Pairing link copied" });
              }}
            >
              <Copy /> Copy pairing link
            </ActionButton>
          </>
        )}
      </div>
    </ResponsiveSheet>
  );
}
