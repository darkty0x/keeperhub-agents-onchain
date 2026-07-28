import type { ChainId } from "../types.js";

/** KeeperHub `network` fields expect chain id strings (see docs). */
export const CHAIN_NETWORK_IDS: Record<ChainId, string> = {
  sepolia: "11155111",
  ethereum: "1",
  base: "8453",
};

export function networkIdForChain(chainId: ChainId): string {
  return CHAIN_NETWORK_IDS[chainId];
}
