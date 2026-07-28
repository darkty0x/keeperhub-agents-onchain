import type { AppConfig, Observation } from "./types.js";

export async function observe(config: AppConfig): Promise<Observation> {
  let nativeBalanceWei = "0";

  try {
    const res = await fetch(config.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getBalance",
        params: [config.walletAddress, "latest"],
      }),
    });
    const body = (await res.json()) as { result?: string };
    if (body.result) nativeBalanceWei = BigInt(body.result).toString();
  } catch {
    // Keep zero so an injected or demo guardian observation can still run.
  }

  const eth = Number(BigInt(nativeBalanceWei)) / 1e18;
  return {
    at: new Date().toISOString(),
    chainId: config.chainId,
    walletAddress: config.walletAddress,
    nativeBalanceWei,
    metricName: config.guardian.metricName,
    metricValue: eth,
    threshold: config.guardian.threshold,
    thresholdDirection: config.guardian.thresholdDirection,
  };
}
