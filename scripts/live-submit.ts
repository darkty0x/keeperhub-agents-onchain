#!/usr/bin/env tsx
/**
 * Live submission helper: mcp-probe → guardian breach (tiny transfer) → print hash.
 * Requires KEEPERHUB_API_KEY, real WALLET_ADDRESS + RECIPIENT_ADDRESS, KEEPERHUB_MOCK unset.
 */
import "dotenv/config";
import fs from "node:fs";
import { loadConfig } from "../src/config.js";
import { AuditStore } from "../src/audit.js";
import { runAgentCycle } from "../src/agent/core.js";
import {
  createHttpKeeperHubClientFromEnv,
  createKeeperHubClientFromEnv,
  summarizeToolsForProbe,
} from "../src/keeperhub/client.js";
import {
  assertLiveAddresses,
  assertLiveExecutionAllowed,
  findLiveTxHash,
  isPlaceholderAddress,
} from "../src/live-gate.js";
import type { Observation } from "../src/types.js";

async function main() {
  process.env.REQUIRE_LIVE_KEEPERHUB = "1";
  delete process.env.KEEPERHUB_MOCK;

  const config = loadConfig(process.env.CONFIG_PATH ?? "config/default.json");
  const apiKey = process.env[config.keeperhubApiKeyEnv];
  assertLiveExecutionAllowed(apiKey);
  assertLiveAddresses(config);

  if (isPlaceholderAddress(config.walletAddress)) {
    throw new Error("Set WALLET_ADDRESS to a real address before live submit");
  }

  const client = createHttpKeeperHubClientFromEnv(config.keeperhubApiKeyEnv);
  console.error("Probing MCP tools/list…");
  const tools = await client.listTools();
  const summary = summarizeToolsForProbe(tools, config.chainId);
  console.error(JSON.stringify(summary.focus, null, 2));

  const store = new AuditStore(process.env.AUDIT_PATH ?? "data/audit.jsonl");
  const keeperhub = createKeeperHubClientFromEnv(config.keeperhubApiKeyEnv);

  const threshold = config.guardian.threshold;
  const observation: Observation = {
    at: new Date().toISOString(),
    chainId: config.chainId,
    walletAddress: config.walletAddress,
    nativeBalanceWei: "0",
    metricName: config.guardian.metricName,
    metricValue: threshold / 2,
    threshold,
    thresholdDirection: config.guardian.thresholdDirection,
  };

  console.error("Running guardian breach via live KeeperHub…");
  const result = await runAgentCycle({
    trigger: "guardian",
    config,
    store,
    keeperhub,
    observation,
  });

  const hash = result.audit.txHash;
  if (!hash || /mock/i.test(hash)) {
    console.error(JSON.stringify(result, null, 2));
    throw new Error("Live run did not return a real tx hash");
  }

  const live = findLiveTxHash(store.list(50));
  console.log(
    JSON.stringify(
      {
        ok: true,
        txHash: hash,
        liveTxHash: live,
        etherscan: `https://sepolia.etherscan.io/tx/${hash}`,
        auditId: result.audit.id,
        actionId: result.audit.decision?.actionId,
      },
      null,
      2,
    ),
  );

  const readmePath = "README.md";
  if (fs.existsSync(readmePath)) {
    let readme = fs.readFileSync(readmePath, "utf8");
    readme = readme.replace(
      /- \[ \] Real KeeperHub Sepolia transaction: `PLACEHOLDER`.*/,
      `- [x] Real KeeperHub Sepolia transaction: \`${hash}\``,
    );
    readme = readme.replace(
      /- \[ \] Etherscan link: `PLACEHOLDER`.*/,
      `- [x] Etherscan link: https://sepolia.etherscan.io/tx/${hash}`,
    );
    fs.writeFileSync(readmePath, readme);
    console.error("Updated README.md submission checklist with live hash.");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
