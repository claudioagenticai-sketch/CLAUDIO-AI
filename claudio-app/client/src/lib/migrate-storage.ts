// One-time fix-ups of saved preferences. Imported first in main.tsx so it runs before any persisted store hydrates.

const CHAIN_FLAG = "claudio.migrated.chain.v1";

try {
  // Solana is the default (and only live) chain now. Anyone whose saved chain was Robinhood or BNB is moved to
  // Solana once; after that their choice is respected.
  if (localStorage.getItem(CHAIN_FLAG) === null) {
    const raw = localStorage.getItem("claudio.settings.v1");
    if (raw) {
      const saved = JSON.parse(raw) as { state?: { chain?: string } };
      if (saved?.state && (saved.state.chain === "hood" || saved.state.chain === "bsc")) {
        saved.state.chain = "sol";
        localStorage.setItem("claudio.settings.v1", JSON.stringify(saved));
      }
    }
    localStorage.setItem(CHAIN_FLAG, "1");
  }
} catch {
  /* storage blocked (private mode) or unreadable JSON — nothing to migrate */
}

export {};
