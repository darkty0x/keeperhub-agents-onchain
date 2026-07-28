import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";
import path from "node:path";

describe("loadConfig", () => {
  it("loads default.json and keeps sepolia as chain", () => {
    const cfg = loadConfig(path.join(process.cwd(), "config/default.json"));
    expect(cfg.chainId).toBe("sepolia");
    expect(cfg.allowedActions.length).toBeGreaterThan(0);
    expect(cfg.killSwitch).toBe(false);
  });

  it("rejects empty recipient allowlist when transfers exist", () => {
    expect(() =>
      loadConfig(path.join(process.cwd(), "tests/fixtures/bad-config.json")),
    ).toThrow(/recipientAllowlist/i);
  });
});
