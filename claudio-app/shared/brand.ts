// Product identity — change the name here and everything follows.
export const BRAND = {
  name: "CLAUDIO",
  full: "Claudio",
  ticker: "$CLAUDIO",
  tagline: "Where humans and agents launch and trade.",
  version: "3.0.0-alpha",
  site: "https://useclaudio.xyz",
  domain: "useclaudio.xyz",
  twitter: "https://x.com/ClaudioAgentAi",
  github: "https://github.com/claudioagenticai-sketch/CLAUDIO-AI",
  /**
   * Compile-time fallback only. The live switch is the server's COMING_SOON env (default on) and the
   * preview cookie — the client asks /api/health which one applies to this visitor (see client/src/App.tsx).
   */
  comingSoon: true,
} as const;
