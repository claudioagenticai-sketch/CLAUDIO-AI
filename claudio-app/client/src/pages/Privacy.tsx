// /privacy — public even while the site is "coming soon" (app reviews and MCP directories link here).
import { LegalLayout } from "@/features/legal/LegalLayout";
import { PRIVACY_INTRO, PRIVACY_SECTIONS } from "@/features/legal/privacy";

export default function Privacy() {
  return <LegalLayout path="/privacy" title="Privacy policy" intro={PRIVACY_INTRO} sections={PRIVACY_SECTIONS} />;
}
