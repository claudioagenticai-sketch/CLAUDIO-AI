// Scores ported from the GMGN skills (gmgn-dev-score, gmgn-contract-dd, gmgn-holder-analysis, gmgn-kline-pattern,
// gmgn-wallet-style / -score / -review). Owner: scores workstream. Pure functions over RAW GMGN responses (the `data`
// field of each endpoint, exactly as GMGN returns it; a whole {code,message,data} envelope is also accepted) — parse
// defensively, never throw, return grade "unknown" when the input is too thin. Inject `now` (unix ms) for determinism.
//
// Every Score satisfies Σ reasons[].points === value (to 0.1): the first reason is the base, every deduction, shrink,
// cap and clamp is its own signed reason, and 0-point reasons are disclosed facts that do not move the number.
//
//   devScore            dev_score.py            created_tokens + wallet_stats + per-coin dev wallet_activity → conduct / power / total
//   contractDD          gmgn-contract-dd        token info + security (+ pool, candles, rug_ratio) → safety 0–100
//   holderAnalysis      gmgn-holder-analysis    token info + top-100 holders → rating band 0–100 + breakdown
//   klinePattern        gmgn-kline-pattern      Candle[] → named pattern + 0–100 (candlesFromGmgn converts GMGN kline)
//   walletProfileScores gmgn-wallet-style/-score/-review → style title + badges, track-record score, two-sentence review
export { UNKNOWN_SCORE } from "./util";
export type { Candle } from "./util";
export { devScore } from "./dev";
export type { DevFacts, DevScoreInput, DevScoreResult, DumpTier, DevBand, FlagshipStatus } from "./dev";
export { contractDD } from "./contract";
export type { ContractDDInput, ContractDDScore } from "./contract";
export { holderAnalysis } from "./holders";
export type { HolderAnalysisInput } from "./holders";
export { klinePattern, candlesFromGmgn, KLINE_PATTERNS } from "./kline";
export type { KlinePattern } from "./kline";
export { walletProfileScores, STYLE_TITLES, STYLE_SPEEDS, STYLE_BADGES } from "./wallet";
export type { WalletProfileInput, WalletProfileResult } from "./wallet";
