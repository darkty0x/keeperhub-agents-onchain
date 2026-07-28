import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AuditStore } from "../src/audit.js";
import type { AuditRecord } from "../src/types.js";

function sample(partial: Partial<AuditRecord> = {}): AuditRecord {
  return {
    id: partial.id ?? "a1",
    at: partial.at ?? "2026-07-28T00:00:00.000Z",
    trigger: "manual",
    observation: {
      at: "2026-07-28T00:00:00.000Z",
      chainId: "sepolia",
      walletAddress: "0x1",
      nativeBalanceWei: "0",
    },
    decision: { actionId: "noop", rationale: "n", fromRules: true },
    policy: { allowed: true, reasons: [] },
    outcome: partial.outcome ?? "success",
    txHash: partial.txHash,
    ...partial,
  };
}

describe("AuditStore", () => {
  let dir: string;
  let store: AuditStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-"));
    store = new AuditStore(path.join(dir, "audit.jsonl"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("appends and lists newest first", () => {
    store.append(sample({ id: "1", at: "2026-07-28T01:00:00.000Z" }));
    store.append(sample({ id: "2", at: "2026-07-28T02:00:00.000Z" }));
    expect(store.list(10).map((r) => r.id)).toEqual(["2", "1"]);
  });

  it("tracks lastSuccessAt from successful runs with tx", () => {
    store.append(sample({ id: "1", outcome: "failed" }));
    store.append(
      sample({
        id: "2",
        outcome: "success",
        txHash: "0xabc",
        at: "2026-07-28T03:00:00.000Z",
      }),
    );
    expect(store.lastSuccessAt()).toBe("2026-07-28T03:00:00.000Z");
  });

  it("seeds submission hashes once", async () => {
    const { seedSubmissionAudits } = await import("../src/audit.js");
    const hash =
      "0xa1f45ff4f674958b51030f3b5ac30e7a2cd94aeb0167ab3aad207774241f41b3";
    process.env.SUBMISSION_TX_HASH = hash;
    delete process.env.SUBMISSION_TX_HASHES;
    expect(
      seedSubmissionAudits(store, { walletAddress: "0x1", chainId: "sepolia" }),
    ).toBe(1);
    expect(
      seedSubmissionAudits(store, { walletAddress: "0x1", chainId: "sepolia" }),
    ).toBe(0);
    expect(store.hasTxHash(hash)).toBe(true);
  });
});
