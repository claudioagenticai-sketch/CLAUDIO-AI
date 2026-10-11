// /terms — public even while the site is "coming soon" (app reviews and MCP directories link here).
import { LegalLayout } from "@/features/legal/LegalLayout";
import { TERMS_INTRO, TERMS_SECTIONS } from "@/features/legal/terms";

export default function Terms() {
  return <LegalLayout path="/terms" title="Terms of use" intro={TERMS_INTRO} sections={TERMS_SECTIONS} />;
}
