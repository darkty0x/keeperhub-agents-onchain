import { describe, it, expect, afterEach } from "vitest";
import {
  assertLiveAddresses,
  assertLiveExecutionAllowed,
  findLiveTxHash,
  isMockExecution,
  isPlaceholderAddress,
  LiveKeeperHubRequiredError,
  requireLiveKeeperHubEnabled,
} from "../src/live-gate.js";
import type { AppConfig } from "../src/types.js";

const baseConfig = (): AppConfig => ({
  chainId: "sepolia",
  walletAddress: "0x0000000000000000000000000000000000000001",
  rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
  keeperhubApiKeyEnv: "KEEPERHUB_API_KEY",
  killSwitch: false,
  maxAmountWei: "1000",
  recipientAllowlist: ["0x0000000000000000000000000000000000000002"],
  chainAllowlist: ["sepolia"],
  cooldownSeconds: 0,
  guardian: {
    intervalSeconds: 30,
    metricName: "nativeBalanceEth",
    threshold: 0.01,
    thresholdDirection: "below",
  },
  events: {
    contractAddress: "0x0000000000000000000000000000000000000003",
    eventSignature: "Transfer(address,address,uint256)",
  },
  allowedActions: [
    {
      id: "transfer-topup",
      kind: "transfer",
      description: "transfer",
      maxAmountWei: "1000",
      recipient: "0x0000000000000000000000000000000000000002",
    },
  ],
  x402: { priceUsdc: "0.01", payTo: "0x0000000000000000000000000000000000000004" },
  preferTransferFirst: true,
});

describe("live-gate", () => {
  const envKeys = [
    "REQUIRE_LIVE_KEEPERHUB",
    "NODE_ENV",
    "KEEPERHUB_MOCK",
    "SUBMISSION_TX_HASH",
  ] as const;
  const saved: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of envKeys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
      delete saved[key];
    }
  });

  function stash(key: (typeof envKeys)[number]) {
    if (!(key in saved)) saved[key] = process.env[key];
  }

  it("detects placeholder addresses", () => {
    expect(isPlaceholderAddress("0x0000000000000000000000000000000000000001")).toBe(true);
    expect(isPlaceholderAddress("0x1111111111111111111111111111111111111111")).toBe(false);
  });

  it("treats missing key or MOCK=1 as mock execution", () => {
    stash("KEEPERHUB_MOCK");
    delete process.env.KEEPERHUB_MOCK;
    expect(isMockExecution(undefined)).toBe(true);
    expect(isMockExecution("kh_test")).toBe(false);
    process.env.KEEPERHUB_MOCK = "1";
    expect(isMockExecution("kh_test")).toBe(true);
  });

  it("blocks mock when REQUIRE_LIVE_KEEPERHUB=1", () => {
    stash("REQUIRE_LIVE_KEEPERHUB");
    stash("KEEPERHUB_MOCK");
    process.env.REQUIRE_LIVE_KEEPERHUB = "1";
    process.env.KEEPERHUB_MOCK = "1";
    expect(requireLiveKeeperHubEnabled()).toBe(true);
    expect(() => assertLiveExecutionAllowed("kh_x")).toThrow(LiveKeeperHubRequiredError);
  });

  it("blocks missing key when REQUIRE_LIVE_KEEPERHUB=1", () => {
    stash("REQUIRE_LIVE_KEEPERHUB");
    stash("KEEPERHUB_MOCK");
    process.env.REQUIRE_LIVE_KEEPERHUB = "1";
    delete process.env.KEEPERHUB_MOCK;
    expect(() => assertLiveExecutionAllowed(undefined)).toThrow(/KEEPERHUB_API_KEY/);
  });

  it("does not require live solely because NODE_ENV=production", () => {
    stash("NODE_ENV");
    stash("REQUIRE_LIVE_KEEPERHUB");
    process.env.NODE_ENV = "production";
    delete process.env.REQUIRE_LIVE_KEEPERHUB;
    expect(requireLiveKeeperHubEnabled()).toBe(false);
  });

  it("blocks placeholder addresses in live mode", () => {
    stash("REQUIRE_LIVE_KEEPERHUB");
    process.env.REQUIRE_LIVE_KEEPERHUB = "1";
    expect(() => assertLiveAddresses(baseConfig())).toThrow(/placeholder/i);
  });

  it("allows real addresses in live mode", () => {
    stash("REQUIRE_LIVE_KEEPERHUB");
    process.env.REQUIRE_LIVE_KEEPERHUB = "1";
    const cfg = baseConfig();
    cfg.walletAddress = "0x1111111111111111111111111111111111111111";
    cfg.recipientAllowlist = ["0x2222222222222222222222222222222222222222"];
    cfg.allowedActions[0]!.recipient = "0x2222222222222222222222222222222222222222";
    expect(() => assertLiveAddresses(cfg)).not.toThrow();
  });

  it("finds live tx hash and ignores MOCK", () => {
    expect(
      findLiveTxHash([
        { outcome: "success", txHash: "0xMOCKabc" },
        { outcome: "success", txHash: "0xabc123def456" },
      ]),
    ).toBe("0xabc123def456");
  });
});
