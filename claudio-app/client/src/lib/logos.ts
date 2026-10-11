// Official brand marks, served from client/public/brand/. Sources and usage rules: client/public/brand/SOURCES.md.
// Anything missing here (or failing to load) falls back to the registry glyph/colour dot.
import type { ChainId } from "@shared/chains";
import type { LaunchpadId } from "@shared/launchpads";

const B = "/brand";

export const CHAIN_LOGOS: Partial<Record<ChainId, string>> = {
  hood: `${B}/chains/hood.svg`,
  sol: `${B}/chains/sol.svg`,
  bsc: `${B}/chains/bsc.svg`,
  base: `${B}/chains/base.svg`,
  arc: `${B}/chains/arc.svg`,
};

export const LAUNCHPAD_LOGOS: Partial<Record<LaunchpadId, string>> = {
  pump: `${B}/launchpads/pump.webp`,
  bonk: `${B}/launchpads/bonk.webp`,
  bags: `${B}/launchpads/bags.webp`,
  heaven: `${B}/launchpads/heaven.webp`,
  stonkfun: `${B}/launchpads/stonkfun.svg`,
  four: `${B}/launchpads/four.svg`,
  flap: `${B}/launchpads/flap.svg`,
  genius: `${B}/launchpads/genius.svg`,
  pons: `${B}/launchpads/pons.webp`,
  pools: `${B}/launchpads/pools.svg`,
  clanker: `${B}/launchpads/clanker.webp`,
  trench: `${B}/launchpads/trench.svg`,
  dyor: `${B}/launchpads/dyor.svg`,
  argus: `${B}/launchpads/argus.webp`,
};

/** Marks that ship on their own solid background: clip them to a circle. Transparent marks render uncropped. */
const SOLID_BG = new Set<string>(["bags", "heaven", "genius", "pools", "argus"]);
export function isSolidMark(id: string): boolean {
  return SOLID_BG.has(id);
}

/** Dark marks on transparent backgrounds: they need a light disc behind them on the dark theme. */
const DARK_MARK = new Set<string>(["pons"]);
export function isDarkMark(id: string): boolean {
  return DARK_MARK.has(id);
}

/** Post-migration AMM venues, keyed by the `venue` prefix ("uniswap-v4" → "uniswap"). */
export const VENUE_LOGOS: Record<string, string> = {
  pumpswap: `${B}/launchpads/pumpswap.webp`,
  raydium: `${B}/launchpads/raydium.svg`,
  meteora: `${B}/launchpads/meteora.svg`,
  pancakeswap: `${B}/launchpads/pancakeswap.webp`,
  pancake: `${B}/launchpads/pancakeswap.webp`,
  uniswap: `${B}/launchpads/uniswap.svg`,
};

export function venueLogo(venue?: string): string | undefined {
  if (!venue) return undefined;
  if (VENUE_LOGOS[venue]) return VENUE_LOGOS[venue];
  return VENUE_LOGOS[venue.split("-")[0]];
}

/** Native gas tokens, keyed by CHAINS[c].nativeSymbol. */
export const TOKEN_LOGOS: Record<string, string> = {
  ETH: `${B}/tokens/eth.svg`,
  SOL: `${B}/tokens/sol.svg`,
  BNB: `${B}/tokens/bnb.svg`,
  USDC: `${B}/tokens/usdc.svg`,
};

/** Injected wallets, keyed by a lowercase name fragment ("MetaMask" → "metamask"). */
export const WALLET_LOGOS: Record<string, string> = {
  metamask: `${B}/wallets/metamask.svg`,
  phantom: `${B}/wallets/phantom.svg`,
  rabby: `${B}/wallets/rabby.svg`,
  coinbase: `${B}/wallets/coinbase-wallet.svg`,
  backpack: `${B}/wallets/backpack.webp`,
  solflare: `${B}/wallets/solflare.svg`,
  okx: `${B}/wallets/okx-wallet.webp`,
};

export function walletLogo(name?: string): string | undefined {
  const n = (name ?? "").toLowerCase();
  const key = Object.keys(WALLET_LOGOS).find((k) => n.includes(k));
  return key ? WALLET_LOGOS[key] : undefined;
}
