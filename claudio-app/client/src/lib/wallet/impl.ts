// Wallet implementation behind the ./index.ts contract.
//
//   state.ts     public reactive store (no secrets) + prompt flag
//   keystore.ts  encrypted vault, in-memory secrets, auto-lock, injected wallets, requireUnlocked
//   send.ts      signAndSend (EVM via viem, Solana via web3.js)
//   balance.ts   useNativeBalance + token balance readers
//   rpc.ts       endpoints/clients (one place to change RPCs)
//
// Other modules import ONLY from "@/lib/wallet". The wallet UI (features/wallet, pages) may import the
// richer keystore API from "@/lib/wallet/keystore".

export { useWallet, getActiveAccount, useActiveAccount } from "./state";
export { requireUnlocked, openWalletPrompt } from "./keystore";
export { signAndSend, SendError } from "./send";
export { useNativeBalance } from "./balance";
