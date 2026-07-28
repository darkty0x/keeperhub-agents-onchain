import type { Observation, AgentRunResult, AppConfig } from "../types.js";

export interface ChainEvent {
  name: string;
  txHash?: string;
  payload: Record<string, unknown>;
}

export async function handleChainEvent(deps: {
  config: AppConfig;
  event: ChainEvent;
  runCycle: (observation: Observation) => Promise<AgentRunResult>;
}): Promise<AgentRunResult> {
  const base: Observation = {
    at: new Date().toISOString(),
    chainId: deps.config.chainId,
    walletAddress: deps.config.walletAddress,
    nativeBalanceWei: "0",
    recentEvent: {
      name: deps.event.name,
      payload: deps.event.payload,
      ...(deps.event.txHash !== undefined
        ? { txHash: deps.event.txHash }
        : {}),
    },
  };
  return deps.runCycle(base);
}
