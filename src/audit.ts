import fs from "node:fs";
import path from "node:path";
import type { AuditRecord } from "./types.js";

export class AuditStore {
  constructor(private readonly filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, "");
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
}
