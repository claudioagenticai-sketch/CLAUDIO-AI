// The wallets we always offer, detected or not. On a phone a tap opens this page inside the wallet's own browser
// (where it injects itself and discovery.ts finds it); on a computer it links to the install page.
import type { ChainKind } from "@shared/chains";
import { walletLogo } from "@/lib/logos";

export interface PopularWallet {
  id: string;
  name: string;
  kinds: ChainKind[];
  logo?: string;
  install: string;
  /** Universal link that opens `url` in the wallet's in-app browser. */
  browse(url: string): string;
}

const enc = encodeURIComponent;
const ref = () => enc(window.location.origin);

// Solana first.
export const POPULAR_WALLETS: PopularWallet[] = [
  {
    id: "phantom",
    name: "Phantom",
    kinds: ["svm", "evm"],
    logo: walletLogo("phantom"),
    install: "https://phantom.com/download",
    browse: (url) => `https://phantom.app/ul/browse/${enc(url)}?ref=${ref()}`,
  },
  {
    id: "solflare",
    name: "Solflare",
    kinds: ["svm"],
    logo: walletLogo("solflare"),
    install: "https://solflare.com/download",
    browse: (url) => `https://solflare.com/ul/v1/browse/${enc(url)}?ref=${ref()}`,
  },
  {
    id: "backpack",
    name: "Backpack",
    kinds: ["svm", "evm"],
    logo: walletLogo("backpack"),
    install: "https://backpack.app/download",
    browse: (url) => `https://backpack.app/ul/v1/browse/${enc(url)}?ref=${ref()}`,
  },
  {
    id: "metamask",
    name: "MetaMask",
    kinds: ["evm"],
    logo: walletLogo("metamask"),
    install: "https://metamask.io/download/",
    browse: (url) => `https://metamask.app.link/dapp/${url.replace(/^https?:\/\//, "")}`,
  },
];

/** Phone or tablet (iPadOS reports itself as a Mac with touch). */
export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}
