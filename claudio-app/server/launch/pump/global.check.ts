// Live check: the Global decoder's fee-recipient lists (mainnet: must equal the docs/FEE_RECIPIENTS.md constants).
//   npx tsx server/launch/pump/global.check.ts        (CLAUDIO_NETWORK=testnet → devnet)
import { BUYBACK_FEE_RECIPIENTS, FEE_RECIPIENTS, MAYHEM_FEE_RECIPIENTS } from "./ixs";
import { pumpFeeRecipients } from "./global";

const same = (a: { toBase58(): string }[], b: { toBase58(): string }[]) => a.map((x) => x.toBase58()).sort().join() === b.map((x) => x.toBase58()).sort().join();

pumpFeeRecipients().then((r) => {
  console.log(`source=${r.source} normal=${r.normal.length} mayhem=${r.mayhem.length} buyback=${r.buyback.length}`);
  console.log(`equal to constants: normal ${same(r.normal, FEE_RECIPIENTS)} mayhem ${same(r.mayhem, MAYHEM_FEE_RECIPIENTS)} buyback ${same(r.buyback, BUYBACK_FEE_RECIPIENTS)}`);
  process.exit(r.source === "chain" ? 0 : 1);
});
