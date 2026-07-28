import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runAgentCycle } from "../src/agent/core.js";
import { AuditStore } from "../src/audit.js";
import { loadConfig } from "../src/config.js";
import { MockKeeperHubClient } from "../src/keeperhub/mock.js";

describe("runAgentCycle", () => {
  let dir: string;
  let store: AuditStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "core-"));
    store = new AuditStore(path.join(dir, "a.jsonl"));
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("blocks when kill switch on and still writes audit", async () => {
    const config = { ...loadConfig("config/default.json"), killSwitch: true };
    const result = await runAgentCycle({
      trigger: "manual",
      config,
      store,
      keeperhub: new MockKeeperHubClient(),
      observation: {
        at: new Date().toISOString(),
        chainId: "sepolia",
        walletAddress: config.walletAddress,
        nativeBalanceWei: "0",
        metricName: "nativeBalanceEth",
        metricValue: 0.001,
        threshold: 0.01,
        thresholdDirection: "below",
      },
    });

    expect(result.audit.outcome).toBe("blocked");
    expect(store.list(1)[0]?.id).toBe(result.audit.id);
  });

  it("executes and records tx hash on breach", async () => {
    const config = loadConfig("config/default.json");
    const result = await runAgentCycle({
      trigger: "guardian",
      config,
      store,
      keeperhub: new MockKeeperHubClient(),
      observation: {
        at: new Date().toISOString(),
        chainId: "sepolia",
        walletAddress: config.walletAddress,
        nativeBalanceWei: "0",
        metricName: "nativeBalanceEth",
        metricValue: 0.001,
        threshold: 0.01,
        thresholdDirection: "below",
      },
      amountWeiForAction: "1",
    });

    expect(result.audit.outcome).toBe("success");
    expect(result.audit.txHash).toMatch(/^0xMOCK/i);
  });
});
