// Hate-slur filter for coin names / tickers shown from third-party feeds (GMGN signals, KOL and smart-money trades).
// Deliberately short: it hides slurs, not edgy memes. Leetspeak and separators are folded first ("n1gg3r", "k.i.k.e").
// Long slurs are matched inside the folded string (they hide in compounds like "BIGNIGGA"); short ones only as whole words
// so "Raccoon", "Kiket" or "Spicy" don't trip.
const LONG = /n+[i]+g{2,}(?:e+r+|a+h?|u+h|ah)|f+a+g{2,}o+t+|tr+a+n{2,}(?:y|i+e)|r+e+t+a+r+d|wetback/;
const SHORT = new Set(["fag", "fags", "kike", "kikes", "chink", "chinks", "spic", "spics", "coon", "coons", "nig", "nigs"]);
const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i" };

function words(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[013457@$!]/g, (c) => LEET[c] ?? c)
    .split(/[^a-z.]+/)
    .map((w) => w.replace(/\./g, "")) // "k.i.k.e" → "kike"
    .filter(Boolean);
}

function offensive(s: string): boolean {
  const ws = words(s);
  return ws.some((w) => SHORT.has(w)) || LONG.test(ws.join(""));
}

/** True when a coin's name or ticker contains a hate slur. */
export function isOffensiveName(...parts: (string | null | undefined)[]): boolean {
  return parts.some((p) => !!p && offensive(p));
}
