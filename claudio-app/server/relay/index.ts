// Relays: machine endpoints that help Claudio Local / the CLI talk to social networks without us holding any of
// the user's secrets. Both work while COMING_SOON is on (server/access.ts lets /relay/* through).
//   /relay/oauth/callback  stateless OAuth bounce to http://127.0.0.1:<port>/oauth/callback   (./oauth.ts)
//   /relay/media           short-lived public media links, swept after their TTL               (./media.ts)
import type { Express } from "express";
import { registerRelayMediaRoutes } from "./media";
import { registerRelayOAuthRoutes } from "./oauth";

export { addRelayTokenVerifier, verifyRelayToken, type RelayCheck, type RelayPrincipal, type RelayTokenVerifier } from "./auth";
export { relayMediaStats } from "./media";

export function registerRelayRoutes(app: Express): void {
  registerRelayOAuthRoutes(app);
  registerRelayMediaRoutes(app);
  // Anything else under /relay is a JSON 404, never the SPA.
  app.use("/relay", (_req, res) => {
    res.set("Cache-Control", "no-store").status(404).json({ error: "not_found", message: "No such relay endpoint" });
  });
}
