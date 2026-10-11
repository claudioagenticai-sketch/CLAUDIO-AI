// Trade route registry. `findRoute(token)` picks the first builder that can trade this token in its current phase.
// To add a venue: implement TradeRouteBuilder in its own file and append it to ROUTES (most specific first).

import { LAUNCHPADS } from "@shared/launchpads";
import type { TokenSnapshot } from "@shared/types";
import { ponsCurveRoute } from "./pons";
import { pumpCurveRoute } from "./pumpCurve";
import { pumpPortalRoute } from "./solana";
import { TradeError, type TradeRouteBuilder } from "./types";

// pump.fun curve coins use our own instructions; graduated/migrated ones (and Bonk) go to PumpPortal.
const ROUTES: TradeRouteBuilder[] = [ponsCurveRoute, pumpCurveRoute, pumpPortalRoute];

export function findRoute(token: TokenSnapshot): TradeRouteBuilder | null {
  return ROUTES.find((r) => r.matches(token)) ?? null;
}

const PHASE_LABEL: Record<TokenSnapshot["phase"], string> = {
  new: "bonding-curve",
  almost: "bonding-curve",
  migrated: "migrated",
};

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function unsupportedError(token: TokenSnapshot): TradeError {
  const lp = LAUNCHPADS[token.launchpad];
  const phase = lp.model === "instant" ? "" : ` ${PHASE_LABEL[token.phase]}`;
  return new TradeError(
    501,
    "route_unsupported",
    `Trading ${lp.name}${phase} tokens isn't wired yet — trade on ${hostOf(lp.site)}`,
    lp.site,
  );
}

export interface RouteInfo {
  supported: boolean;
  routeId?: string;
  label?: string;
  /** Quotes are off-chain approximations on this route. */
  estimateOnly: boolean;
  site: string;
  message?: string;
}

export function routeInfo(token: TokenSnapshot): RouteInfo {
  const r = findRoute(token);
  const site = LAUNCHPADS[token.launchpad].site;
  if (!r) return { supported: false, estimateOnly: false, site, message: unsupportedError(token).message };
  return { supported: true, routeId: r.id, label: r.label, estimateOnly: r.id === pumpPortalRoute.id, site };
}
