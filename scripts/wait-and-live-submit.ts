#!/usr/bin/env tsx
/**
 * Poll Sepolia balance for the configured wallet; when funded, run live-submit.
 */
import "dotenv/config";
import { loadConfig } from "../src/config.js";

const RPC = process.env.RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";

async function getBalanceWei(address: string): Promise<bigint> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getBalance",
      params: [address, "latest"],
    }),
  });
  const body = (await res.json()) as { result?: string; error?: { message: string } };
  if (body.error) throw new Error(body.error.message);
  return BigInt(body.result ?? "0x0");
}

async function main() {
  const config = loadConfig(process.env.CONFIG_PATH ?? "config/default.json");
  const address = process.env.WALLET_ADDRESS?.trim() || config.walletAddress;
  const minWei = BigInt(process.env.MIN_FUND_WEI ?? "100000000000000"); // 0.0001 ETH
  const intervalMs = Number(process.env.POLL_MS ?? 15_000);
  console.error(`Watching ${address} for >= ${minWei} wei on Sepolia…`);

  for (;;) {
    const bal = await getBalanceWei(address);
    console.error(`${new Date().toISOString()} balance=${bal}`);
    if (bal >= minWei) {
      console.error("Funded — launching live-submit");
      const { spawnSync } = await import("node:child_process");
      const result = spawnSync("npm", ["run", "live-submit"], {
        stdio: "inherit",
        env: {
          ...process.env,
          REQUIRE_LIVE_KEEPERHUB: "1",
          KEEPERHUB_MOCK: undefined,
        },
      });
      process.exit(result.status ?? 1);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
