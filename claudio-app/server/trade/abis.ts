// ABIs used by trade routes. Each fragment below was verified against live chain state, not the repo.
import { parseAbi } from "viem";

/**
 * Pons V2 per-launch BondingCurve (Robinhood Chain, 4663).
 *
 * Verified 2026-09-27:
 *  - Source: `contracts/src/v2/PonsV2BondingCurve.sol` from the Sourcify exact-match verification of the
 *    PonsV2LaunchDeployer 0x3711ceA4feaDE896C913C68F01Eda97Cb06D1A42 (solc 0.8.35, viaIR). The deployer embeds the
 *    curve creation code, so every curve it CREATE2-deploys runs this source. Per-launch curves themselves are not
 *    individually verified on Sourcify/Blockscout.
 *  - Live reads (`cast call`) against curve 0x24d46dc2fa01c1117a32fd3c20c0f5177c56d3cc (from a TokenLaunched log of
 *    factory 0x7eD5…EC7e at block 74052435): token(), pairToken() = 0x0 (ETH), getReserves() = (1.68e18, 1e27),
 *    feeBps() = 100, creatorTaxBps() = 400, sellableTokens(), reservedTokens() = 2.857e26, graduated(), launchedAt(),
 *    snipeTaxSeconds() = 3, currentSnipeTaxBps(address).
 *  - Selectors present in the deployed runtime bytecode: buy 0x59a87bc1, sell 0xd04c6983, getReserves 0x0902f1ac,
 *    currentSnipeTaxBps 0xd7e1ef39, sellableTokens 0x808bcddc.
 *  - `eth_call buy(0.01 ETH, 0, r)` returned 5622965374371115714708493 tokens, identical to the offline formula in
 *    ./pons.ts (net = in − fee − tax − snipe; out = net·Rt / (Rq + net)).
 *  - There are NO quoteBuy/quoteSell views on the live curve; quotes are computed from getReserves() + fee bps.
 */
export const PONS_CURVE_ABI = parseAbi([
  "function token() view returns (address)",
  "function pairToken() view returns (address)",
  "function feeBps() view returns (uint256)",
  "function creatorTaxBps() view returns (uint256)",
  "function reservedTokens() view returns (uint256)",
  "function launchedAt() view returns (uint256)",
  "function snipeTaxStartBps() view returns (uint256)",
  "function snipeTaxSeconds() view returns (uint256)",
  "function graduated() view returns (bool)",
  "function getReserves() view returns (uint256 quoteReserve_, uint256 tokenReserve_)",
  "function sellableTokens() view returns (uint256)",
  "function currentSnipeTaxBps(address recipient) view returns (uint256)",
  "function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) payable returns (uint256 tokensOut)",
  "function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) returns (uint256 quoteOut)",
]);

/**
 * Minimal ERC-20. Pons LauncherToken is an OpenZeppelin ERC20 (same Sourcify bundle,
 * `PonsV2LauncherToken.sol`); decimals() = 18 verified live on 0x068B8261C320072A024c7c2CB3a2Ae46CA0F0139.
 */
export const ERC20_ABI = parseAbi([
  "function decimals() view returns (uint8)",
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);
