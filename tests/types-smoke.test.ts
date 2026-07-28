import { describe, it, expect } from "vitest";
import type { AuditRecord } from "../src/types.js";

describe("types", () => {
  it("allows constructing a blocked audit shape", () => {
    const record: AuditRecord = {
      id: "1",
      at: new Date().toISOString(),
      trigger: "manual",
      observation: {
        at: new Date().toISOString(),
        chainId: "sepolia",
        walletAddress: "0x1",
        nativeBalanceWei: "0",
      },
      decision: null,
      policy: { allowed: false, reasons: ["kill switch"] },
      outcome: "blocked",
    };
    expect(record.outcome).toBe("blocked");
  });
});
