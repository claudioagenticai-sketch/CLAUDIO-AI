// Manual check (not part of the app): which sign-in service may vouch for which social, and how ids are mapped.
//   npx tsx server/social/auth.check.ts
import { __authInternals as t } from "./auth";
import { identityKey } from "./identity";

let failed = 0;
function expect(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${label}${ok ? "" : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
}

const acct = (provider: Parameters<typeof t.accept>[1]["provider"], id: string, handle?: string) => ({ provider, providerUserId: id, handle, subject: "s" });

// Auth0 connection names / sub prefixes → providers
expect("twitter → x", t.mapProvider("twitter"), "x");
expect("oauth_x → x", t.mapProvider("oauth_x"), "x");
expect("linkedin_oidc → linkedin", t.mapProvider("oauth_linkedin_oidc"), "linkedin");
expect("oauth_huggingface → huggingface", t.mapProvider("oauth_huggingface"), "huggingface");
expect("auth0 (database) → none", t.mapProvider("auth0"), null);
expect("email → none", t.mapProvider("email"), null);
expect("sms → none", t.mapProvider("sms"), null);
expect("custom oauth2 id split", t.splitAuth0Id("oauth2", "discord|80351110224678912"), { connection: "discord", id: "80351110224678912" });
expect("plain id split", t.splitAuth0Id("twitter", "12"), { connection: "twitter", id: "12" });

// Each social only from its own service
expect("x via auth0 accepted", t.accept("auth0", acct("x", "12"))?.providerUserId, "12");
expect("x via clerk REJECTED", t.accept("clerk", acct("x", "12")), null);
expect("github via clerk REJECTED", t.accept("clerk", acct("github", "1")), null);
expect("tiktok via auth0 REJECTED", t.accept("auth0", acct("tiktok", "x", "someone")), null);
expect("huggingface via clerk accepted", t.accept("clerk", acct("huggingface", "5dd9"))?.providerUserId, "5dd9");
expect("google never accepted", [t.accept("auth0", acct("google", "1")), t.accept("clerk", acct("google", "1"))], [null, null]);

// TikTok is handle-keyed: the username must be present and becomes the lowercase id
expect("tiktok without username REJECTED", t.accept("clerk", acct("tiktok", "open_id_abc")), null);
expect("tiktok id = lowercase username", t.accept("clerk", acct("tiktok", "open_id_abc", "@SomeOne"))?.providerUserId, "someone");
expect("tiktok key matches launch-time key", identityKey({ provider: "tiktok", providerUserId: "SomeOne" }), "tiktok:someone");

console.log(failed ? `${failed} FAILED` : "all passed");
process.exit(failed ? 1 : 0);
