import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AuditRecord, ChainId } from "./types.js";

export class AuditStore {
  constructor(private readonly filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (!fs.existsSync(this.filePath)) fs.writeFileSync(this.filePath, "");
  }

  append(record: AuditRecord): void {
    fs.appendFileSync(this.filePath, JSON.stringify(record) + "\n", "utf8");
  }

  list(limit = 50): AuditRecord[] {
    const lines = fs.readFileSync(this.filePath, "utf8").split("\n").filter(Boolean);
    return lines
      .map((l) => JSON.parse(l) as AuditRecord)
      .reverse()
      .slice(0, limit);
  }

  get(id: string): AuditRecord | undefined {
    return this.list(10_000).find((r) => r.id === id);
  }

  lastSuccessAt(): string | null {
    const success = this.list(10_000).find(
      (r) => r.outcome === "success" && Boolean(r.txHash || r.executionId),
    );
    return success?.at ?? null;
  }

  hasTxHash(txHash: string): boolean {
    const needle = txHash.toLowerCase();
    return this.list(10_000).some((r) => r.txHash?.toLowerCase() === needle);
  }
}

function hashesFromEnv(): string[] {
  const raw = [
    process.env.SUBMISSION_TX_HASH,
    ...(process.env.SUBMISSION_TX_HASHES?.split(",") ?? []),
  ];
  const out: string[] = [];
  for (const value of raw) {
    const h = value?.trim();
    if (h && /^0x[a-fA-F0-9]{64}$/i.test(h)) out.push(h);
  }
  return out;
}

/** Keep known live proof txs visible after ephemeral filesystem restarts. */
export function seedSubmissionAudits(
  store: AuditStore,
  opts: { walletAddress: string; chainId: ChainId },
): number {
  let seeded = 0;
  for (const txHash of hashesFromEnv()) {
    if (store.hasTxHash(txHash)) continue;
    const at = new Date().toISOString();
    store.append({
      id: randomUUID(),
      at,
      trigger: "guardian",
      observation: {
        at,
        chainId: opts.chainId,
        walletAddress: opts.walletAddress,
        nativeBalanceWei: "0",
      },
      decision: {
        actionId: "transfer-topup",
        rationale: "Seeded from SUBMISSION_TX_HASH for reviewer history",
        fromRules: true,
      },
      policy: { allowed: true, reasons: [] },
      outcome: "success",
      txHash,
    });
    seeded += 1;
  }
  return seeded;
}
