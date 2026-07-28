import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";
import path from "node:path";

describe("loadConfig", () => {
  it("loads default.json and keeps sepolia as chain", () => {
    const cfg = loadConfig(path.join(process.cwd(), "config/default.json"));
    expect(cfg.chainId).toBe("sepolia");
    expect(cfg.allowedActions.length).toBeGreaterThan(0);
    expect(cfg.killSwitch).toBe(false);
    expect(cfg.preferTransferFirst).toBe(true);
    expect(cfg.allowedActions[0]?.id).toBe("transfer-topup");
  });

  it("applies WALLET_ADDRESS and RECIPIENT_ADDRESS env overrides", () => {
    const prevW = process.env.WALLET_ADDRESS;
    const prevR = process.env.RECIPIENT_ADDRESS;
    process.env.WALLET_ADDRESS = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    process.env.RECIPIENT_ADDRESS = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    try {
      const cfg = loadConfig(path.join(process.cwd(), "config/default.json"));
      expect(cfg.walletAddress.toLowerCase()).toBe(
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      );
      expect(cfg.recipientAllowlist[0]?.toLowerCase()).toBe(
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      );
      expect(
        cfg.allowedActions.find((a) => a.kind === "transfer")?.recipient?.toLowerCase(),
      ).toBe("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    } finally {
      if (prevW === undefined) delete process.env.WALLET_ADDRESS;
      else process.env.WALLET_ADDRESS = prevW;
      if (prevR === undefined) delete process.env.RECIPIENT_ADDRESS;
      else process.env.RECIPIENT_ADDRESS = prevR;
    }
  });

  it("rejects empty recipient allowlist when transfers exist", () => {
    const prevR = process.env.RECIPIENT_ADDRESS;
    const prevW = process.env.WALLET_ADDRESS;
    delete process.env.RECIPIENT_ADDRESS;
    delete process.env.WALLET_ADDRESS;
    try {
      expect(() =>
        loadConfig(path.join(process.cwd(), "tests/fixtures/bad-config.json")),
      ).toThrow(/recipientAllowlist/i);
    } finally {
      if (prevR === undefined) delete process.env.RECIPIENT_ADDRESS;
      else process.env.RECIPIENT_ADDRESS = prevR;
      if (prevW === undefined) delete process.env.WALLET_ADDRESS;
      else process.env.WALLET_ADDRESS = prevW;
    }
  });
});
