// Manual check (not part of the app): every keyless social lookup against real, well-known accounts, plus a
// not-found case each. Needs network. Pretends both sign-in services are configured so every social is enabled.
//   npx tsx server/social/resolve.check.ts
process.env.CLERK_SECRET_KEY ||= "check";
process.env.AUTH0_DOMAIN ||= "check";
process.env.AUTH0_AUDIENCE ||= "check";

import { resolveHandle, resolvableProviders } from "./resolve";
import type { SocialProvider } from "@shared/social";

// [provider, input, expected stable id | null for "must be not found"]
const CASES: [SocialProvider, string, string | null][] = [
  ["x", "jack", "12"],
  ["x", "https://x.com/github", "13334762"],
  ["x", "zz9qnotreal77x", null],
  ["github", "torvalds", "1024025"],
  ["github", "zz9qnotreal77x", null],
  ["twitch", "shroud", "37402112"],
  ["twitch", "zz9qnotreal77x", null],
  ["spotify", "spotify", "spotify"],
  ["spotify", "zz9qnotreal77x", null],
  ["huggingface", "julien-c", "5dd96eb166059660ed1ee413"],
  ["huggingface", "zz9qnotreal77x", null],
  ["tiktok", "@tiktok", "tiktok"],
  ["tiktok", "zz9qnotreal77x", null],
];

async function main() {
  console.log("resolvable:", resolvableProviders().join(", "));
  let failed = 0;
  for (const [p, input, want] of CASES) {
    try {
      const r = await resolveHandle(p, input);
      const ok = want !== null && r.providerUserId === want;
      if (!ok) failed++;
      console.log(`${ok ? "✓" : "✗"} ${p} ${input} → id ${r.providerUserId} @${r.handle} ${r.avatarUrl ? "pfp" : "no pfp"}${r.followers != null ? ` ${r.followers} followers` : ""}`);
    } catch (e) {
      const err = e as { status?: number; code?: string; message: string };
      const ok = want === null && err.status === 404;
      if (!ok) failed++;
      console.log(`${ok ? "✓" : "✗"} ${p} ${input} → ${err.status} ${err.code}: ${err.message}`);
    }
  }
  for (const p of ["linkedin", "discord"] as SocialProvider[]) {
    const r = await resolveHandle(p, "123456789012345678").then(() => "resolved", (e: Error) => e.message);
    console.log(`  ${p}: ${r}`);
  }
  console.log(failed ? `${failed} FAILED` : "all passed");
  process.exit(failed ? 1 : 0);
}

void main();
