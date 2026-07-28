import { describe, it, expect } from "vitest";
import { decide } from "../src/decision.js";
import { loadConfig } from "../src/config.js";
import path from "node:path";
import type { Observation } from "../src/types.js";

const cfg = () => loadConfig(path.join(process.cwd(), "config/default.json"));

function obs(over: Partial<Observation> = {}): Observation {
  return {
    at: new Date().toISOString(),
    chainId: "sepolia",
    walletAddress: "0x0000000000000000000000000000000000000001",
    nativeBalanceWei: "0",
    metricName: "nativeBalanceEth",
    metricValue: 0.001,
    threshold: 0.01,
    thresholdDirection: "below",
    ...over,
  };
}

describe("decide", () => {
  it("picks a non-noop action when threshold breached (rules)", async () => {
    const decision = await decide(obs(), cfg(), { llm: null });
    expect(decision.fromRules).toBe(true);
    expect(decision.actionId).not.toBe("noop");
  });

  it("picks noop when healthy", async () => {
    const decision = await decide(
      obs({ metricValue: 1, thresholdDirection: "below", threshold: 0.01 }),
      cfg(),
      { llm: null },
    );
    expect(decision.actionId).toBe("noop");
  });
});
