import express, { type NextFunction, type Request, type Response } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { BRAND } from "@shared/brand";

const app = express();
app.disable("x-powered-by");
// Replit (and most hosts) put exactly one proxy in front of the app: trust it so req.ip is the real client
// (per-IP rate limits) and req.secure reflects HTTPS. TRUST_PROXY overrides the hop count.
app.set("trust proxy", Number(process.env.TRUST_PROXY ?? 1));
app.use(
  express.json({
    limit: "2mb",
    // The agent protocol signs SHA-256(raw body): keep the exact bytes for /api/v1 requests (server/agents/agentauth.ts).
    verify: (req, _res, buf) => {
      if (req.url?.startsWith("/api/v1/")) (req as unknown as { rawBody?: Buffer }).rawBody = Buffer.from(buf);
    },
  }),
);
app.use(express.urlencoded({ extended: false }));

// Compact API request log (no response bodies — they can contain user data). Only /api paths, and only the path
// (never the query string). /relay/oauth/* is never logged at all: its query carries OAuth codes.
app.use((req, res, next) => {
  if (req.path.startsWith("/relay/oauth")) return next();
  const start = Date.now();
  res.on("finish", () => {
    if (req.path.startsWith("/api")) log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
});

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    res.status(status).json({ message: err.message || "Internal Server Error" });
    if (status >= 500) console.error(err);
  });

  if (app.get("env") === "development") await setupVite(app, server);
  else serveStatic(app);

  const port = parseInt(process.env.PORT || "5000", 10);
  // reusePort is what Replit's template uses (Linux); macOS rejects it with ENOTSUP, so only set it on Linux.
  server.listen({ port, host: "0.0.0.0", reusePort: process.platform === "linux" }, () => log(`${BRAND.full} serving on port ${port}`));
})();
