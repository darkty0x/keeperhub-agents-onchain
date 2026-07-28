import { describe, it, expect } from "vitest";
import { buildPaymentRequired, hasValidPayment } from "../src/modes/x402.js";
import { loadConfig } from "../src/config.js";
import path from "node:path";

describe("x402", () => {
  const config = loadConfig(path.join(process.cwd(), "config/default.json"));

  it("builds 402 challenge payload", () => {
    const body = buildPaymentRequired(config);
    expect(body).toHaveProperty("x402Version");
    expect(body.accepts[0].maxAmountRequired).toBeDefined();
  });

  it("rejects missing payment header", () => {
    expect(hasValidPayment({}, config)).toBe(false);
  });

  it("accepts demo bypass header when enabled", () => {
    process.env.X402_DEMO_BYPASS = "1";
    expect(hasValidPayment({ "x-payment": "demo" }, config)).toBe(true);
    delete process.env.X402_DEMO_BYPASS;
  });
});
