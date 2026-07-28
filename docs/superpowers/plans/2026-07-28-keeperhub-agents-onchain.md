# KeeperHub Agents Onchain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a TypeScript monolith agent with three modes (guardian, event responder, x402 paid API) that executes real onchain actions through KeeperHub MCP, plus CLI and a thin Next.js demo UI.

**Architecture:** One `runAgentCycle` pipeline (observe → rules/LLM decide → policy → KeeperHub execute → audit). Guardian, event watcher, x402 HTTP, CLI, and web UI are thin triggers into that pipeline.

**Tech Stack:** Node.js 22+, TypeScript 5.x, Vitest, Express (API + x402), Next.js 15 (App Router) for UI, KeeperHub remote MCP (`https://app.keeperhub.com/mcp`), optional OpenAI-compatible LLM for rationale.

## Global Constraints

- KeeperHub is the **only** onchain execution layer — no direct `ethers`/`viem` sends for write txs.
- Primary chain: **Sepolia**; optional mainnet demo later.
- Hero action: protocol action (Aave-style); fallback: `execute_check_and_execute` / `execute_transfer`.
- Policy gate + kill switch before every write.
- No multi-agent frameworks; thin custom TS agent only.
- Commit after each task; TDD for core modules.
- Secrets only via `.env` (never commit `KEEPERHUB_API_KEY` / `LLM_API_KEY`).

---

## File Structure

```
/
├── package.json                 # workspace root scripts
├── tsconfig.json
├── vitest.config.ts
├── .env.example
├── README.md
├── src/
│   ├── types.ts                 # shared domain types
│   ├── config.ts                # load/validate config from env + JSON
│   ├── policy.ts                # allowlist, max spend, cooldown, kill switch
│   ├── audit.ts                 # append-only JSONL audit store
│   ├── decision.ts              # rules + optional LLM choice among allowlisted actions
│   ├── observe.ts               # build Observation from config + RPC reads (read-only OK)
│   ├── agent/
│   │   └── core.ts              # runAgentCycle pipeline
│   ├── keeperhub/
│   │   ├── types.ts             # MCP tool request/response shapes
│   │   └── client.ts            # KeeperHubClient (real + injectable)
│   ├── modes/
│   │   ├── guardian.ts          # scheduled threshold watcher
│   │   ├── events.ts            # contract event watcher
│   │   └── x402.ts              # payment challenge + verify helpers
│   ├── server.ts                # Express: /api/status /api/run /api/audit /api/paid/*
│   └── cli.ts                   # run | watch | status | replay
├── config/
│   └── default.json             # demo thresholds, allowlists, Sepolia targets
├── apps/web/                    # Next.js dashboard
│   ├── package.json
│   ├── app/page.tsx
│   ├── app/layout.tsx
│   └── lib/api.ts
└── tests/
    ├── policy.test.ts
    ├── audit.test.ts
    ├── decision.test.ts
    ├── agent-core.test.ts
    ├── x402.test.ts
    └── fixtures/
        └── mock-keeperhub.ts
```

---

### Task 1: Scaffold project + domain types

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.env.example`, `src/types.ts`, `config/default.json`
- Test: `tests/types-smoke.test.ts`

**Interfaces:**
- Produces: `Observation`, `AllowedAction`, `Decision`, `PolicyResult`, `AuditRecord`, `AgentRunResult`, `AppConfig`

- [ ] **Step 1: Init package and TypeScript**

```bash
cd /Users/dell/Downloads/Untitled
npm init -y
npm pkg set type=module name=keeperhub-agents-onchain
npm install typescript vitest tsx zod dotenv --save-dev
npm install zod dotenv
npx tsc --init --rootDir src --outDir dist --module NodeNext --moduleResolution NodeNext --target ES2022 --strict true --esModuleInterop true --skipLibCheck true
```

`package.json` scripts:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "build": "tsc -p tsconfig.json",
    "cli": "tsx src/cli.ts",
    "server": "tsx src/server.ts"
  }
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 2: Write domain types**

Create `src/types.ts`:

```ts
export type ChainId = "sepolia" | "ethereum" | "base";

export type TriggerKind = "manual" | "guardian" | "event" | "x402";

export type ActionKind =
  | "protocol_action"
  | "check_and_execute"
  | "transfer"
  | "noop";

export interface AllowedAction {
  id: string;
  kind: ActionKind;
  /** e.g. aave-v3/withdraw */
  protocolActionType?: string;
  description: string;
  maxAmountWei?: string;
  tokenAddress?: string;
  recipient?: string;
}

export interface Observation {
  at: string;
  chainId: ChainId;
  walletAddress: string;
  nativeBalanceWei: string;
  /** Optional protocol health / metric the guardian watches */
  metricName?: string;
  metricValue?: number;
  threshold?: number;
  thresholdDirection?: "below" | "above";
  recentEvent?: {
    name: string;
    txHash?: string;
    payload: Record<string, unknown>;
  };
}

export interface Decision {
  actionId: string;
  rationale: string;
  /** True if rules alone forced the action without LLM */
  fromRules: boolean;
}

export interface PolicyResult {
  allowed: boolean;
  reasons: string[];
}

export interface AuditRecord {
  id: string;
  at: string;
  trigger: TriggerKind;
  observation: Observation;
  decision: Decision | null;
  policy: PolicyResult;
  executionId?: string;
  txHash?: string;
  outcome: "success" | "blocked" | "failed" | "noop";
  error?: string;
}

export interface AgentRunResult {
  audit: AuditRecord;
}

export interface AppConfig {
  chainId: ChainId;
  walletAddress: string;
  rpcUrl: string;
  keeperhubApiKeyEnv: string;
  killSwitch: boolean;
  maxAmountWei: string;
  recipientAllowlist: string[];
  chainAllowlist: ChainId[];
  cooldownSeconds: number;
  guardian: {
    intervalSeconds: number;
    metricName: string;
    threshold: number;
    thresholdDirection: "below" | "above";
  };
  events: {
    contractAddress: string;
    eventSignature: string;
  };
  allowedActions: AllowedAction[];
  x402: {
    priceUsdc: string;
    payTo: string;
  };
  llm?: {
    enabled: boolean;
    baseUrl: string;
    model: string;
  };
}
```

- [ ] **Step 3: Default config + env example**

`config/default.json`:

```json
{
  "chainId": "sepolia",
  "walletAddress": "0x0000000000000000000000000000000000000001",
  "rpcUrl": "https://ethereum-sepolia-rpc.publicnode.com",
  "keeperhubApiKeyEnv": "KEEPERHUB_API_KEY",
  "killSwitch": false,
  "maxAmountWei": "100000000000000000",
  "recipientAllowlist": ["0x0000000000000000000000000000000000000002"],
  "chainAllowlist": ["sepolia"],
  "cooldownSeconds": 60,
  "guardian": {
    "intervalSeconds": 30,
    "metricName": "nativeBalanceEth",
    "threshold": 0.01,
    "thresholdDirection": "below"
  },
  "events": {
    "contractAddress": "0x0000000000000000000000000000000000000003",
    "eventSignature": "Transfer(address,address,uint256)"
  },
  "allowedActions": [
    {
      "id": "aave-withdraw-buffer",
      "kind": "protocol_action",
      "protocolActionType": "aave-v3/withdraw",
      "description": "Withdraw buffer asset from Aave to top up wallet",
      "maxAmountWei": "50000000000000000"
    },
    {
      "id": "transfer-topup",
      "kind": "transfer",
      "description": "Transfer native ETH top-up to allowlisted recipient",
      "maxAmountWei": "10000000000000000",
      "recipient": "0x0000000000000000000000000000000000000002"
    },
    {
      "id": "noop",
      "kind": "noop",
      "description": "Do nothing"
    }
  ],
  "x402": {
    "priceUsdc": "0.01",
    "payTo": "0x0000000000000000000000000000000000000004"
  },
  "llm": {
    "enabled": false,
    "baseUrl": "https://api.openai.com/v1",
    "model": "gpt-4o-mini"
  }
}
```

`.env.example`:

```
KEEPERHUB_API_KEY=kh_xxx
LLM_API_KEY=
PORT=8787
CONFIG_PATH=config/default.json
AUDIT_PATH=data/audit.jsonl
```

- [ ] **Step 4: Smoke test types compile**

`tests/types-smoke.test.ts`:

```ts
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
```

Run: `npx vitest run tests/types-smoke.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .env.example src/types.ts config/default.json tests/types-smoke.test.ts
git commit -m "chore: scaffold KeeperHub agent project and domain types"
```

---

### Task 2: Config loader

**Files:**
- Create: `src/config.ts`
- Test: `tests/config.test.ts`

**Interfaces:**
- Consumes: `AppConfig` from `src/types.ts`
- Produces: `loadConfig(path?: string): AppConfig`

- [ ] **Step 1: Write failing test**

```ts
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
```

Create `tests/fixtures/bad-config.json` as a copy of default with `"recipientAllowlist": []`.

- [ ] **Step 2: Run test — expect FAIL**

Run: `npx vitest run tests/config.test.ts`  
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `src/config.ts`**

```ts
import fs from "node:fs";
import { z } from "zod";
import type { AppConfig } from "./types.js";

const AllowedActionSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["protocol_action", "check_and_execute", "transfer", "noop"]),
  protocolActionType: z.string().optional(),
  description: z.string(),
  maxAmountWei: z.string().optional(),
  tokenAddress: z.string().optional(),
  recipient: z.string().optional(),
});

const AppConfigSchema = z.object({
  chainId: z.enum(["sepolia", "ethereum", "base"]),
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  rpcUrl: z.string().url(),
  keeperhubApiKeyEnv: z.string().min(1),
  killSwitch: z.boolean(),
  maxAmountWei: z.string().regex(/^\d+$/),
  recipientAllowlist: z.array(z.string()),
  chainAllowlist: z.array(z.enum(["sepolia", "ethereum", "base"])).min(1),
  cooldownSeconds: z.number().int().nonnegative(),
  guardian: z.object({
    intervalSeconds: z.number().int().positive(),
    metricName: z.string(),
    threshold: z.number(),
    thresholdDirection: z.enum(["below", "above"]),
  }),
  events: z.object({
    contractAddress: z.string(),
    eventSignature: z.string(),
  }),
  allowedActions: z.array(AllowedActionSchema).min(1),
  x402: z.object({
    priceUsdc: z.string(),
    payTo: z.string(),
  }),
  llm: z
    .object({
      enabled: z.boolean(),
      baseUrl: z.string(),
      model: z.string(),
    })
    .optional(),
});

export function loadConfig(configPath = process.env.CONFIG_PATH ?? "config/default.json"): AppConfig {
  const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const parsed = AppConfigSchema.parse(raw) as AppConfig;
  const hasTransfer = parsed.allowedActions.some((a) => a.kind === "transfer");
  if (hasTransfer && parsed.recipientAllowlist.length === 0) {
    throw new Error("recipientAllowlist must be non-empty when transfer actions exist");
  }
  if (!parsed.chainAllowlist.includes(parsed.chainId)) {
    throw new Error(`chainId ${parsed.chainId} not in chainAllowlist`);
  }
  return parsed;
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npx vitest run tests/config.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts tests/fixtures/bad-config.json
git commit -m "feat: add zod-validated app config loader"
```

---

### Task 3: Policy gate

**Files:**
- Create: `src/policy.ts`
- Test: `tests/policy.test.ts`

**Interfaces:**
- Consumes: `AppConfig`, `AllowedAction`, `Decision`
- Produces: `evaluatePolicy(input): PolicyResult`

```ts
export interface PolicyInput {
  config: AppConfig;
  decision: Decision;
  action: AllowedAction;
  amountWei: string;
  lastSuccessAt?: string | null;
  now?: Date;
}
export function evaluatePolicy(input: PolicyInput): PolicyResult;
```

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from "vitest";
import { evaluatePolicy } from "../src/policy.js";
import { loadConfig } from "../src/config.js";
import path from "node:path";

const config = () => loadConfig(path.join(process.cwd(), "config/default.json"));

describe("evaluatePolicy", () => {
  it("blocks when kill switch is on", () => {
    const cfg = { ...config(), killSwitch: true };
    const action = cfg.allowedActions.find((a) => a.id === "transfer-topup")!;
    const result = evaluatePolicy({
      config: cfg,
      decision: { actionId: action.id, rationale: "test", fromRules: true },
      action,
      amountWei: "1",
    });
    expect(result.allowed).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/kill switch/i);
  });

  it("blocks amount above max", () => {
    const cfg = config();
    const action = cfg.allowedActions.find((a) => a.id === "transfer-topup")!;
    const result = evaluatePolicy({
      config: cfg,
      decision: { actionId: action.id, rationale: "test", fromRules: true },
      action,
      amountWei: "999000000000000000000",
    });
    expect(result.allowed).toBe(false);
  });

  it("blocks recipient not on allowlist", () => {
    const cfg = config();
    const action = {
      ...cfg.allowedActions.find((a) => a.id === "transfer-topup")!,
      recipient: "0x1111111111111111111111111111111111111111",
    };
    const result = evaluatePolicy({
      config: cfg,
      decision: { actionId: action.id, rationale: "test", fromRules: true },
      action,
      amountWei: "1",
    });
    expect(result.allowed).toBe(false);
  });

  it("blocks during cooldown", () => {
    const cfg = { ...config(), cooldownSeconds: 120 };
    const action = cfg.allowedActions.find((a) => a.id === "noop")!;
    const result = evaluatePolicy({
      config: cfg,
      decision: { actionId: action.id, rationale: "test", fromRules: true },
      action,
      amountWei: "0",
      lastSuccessAt: new Date().toISOString(),
      now: new Date(),
    });
    expect(result.allowed).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/cooldown/i);
  });

  it("allows noop when kill switch off", () => {
    const cfg = config();
    const action = cfg.allowedActions.find((a) => a.id === "noop")!;
    const result = evaluatePolicy({
      config: cfg,
      decision: { actionId: action.id, rationale: "ok", fromRules: true },
      action,
      amountWei: "0",
    });
    expect(result.allowed).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run tests/policy.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implement `src/policy.ts`**

```ts
import type { AllowedAction, AppConfig, Decision, PolicyResult } from "./types.js";

export interface PolicyInput {
  config: AppConfig;
  decision: Decision;
  action: AllowedAction;
  amountWei: string;
  lastSuccessAt?: string | null;
  now?: Date;
}

function normalizeAddr(a: string): string {
  return a.toLowerCase();
}

export function evaluatePolicy(input: PolicyInput): PolicyResult {
  const reasons: string[] = [];
  const { config, action, amountWei } = input;
  const now = input.now ?? new Date();

  if (config.killSwitch) reasons.push("kill switch enabled");
  if (!config.chainAllowlist.includes(config.chainId)) {
    reasons.push(`chain ${config.chainId} not allowlisted`);
  }

  const globalMax = BigInt(config.maxAmountWei);
  const actionMax = action.maxAmountWei ? BigInt(action.maxAmountWei) : globalMax;
  const amount = BigInt(amountWei);
  const maxAllowed = actionMax < globalMax ? actionMax : globalMax;
  if (action.kind !== "noop" && amount > maxAllowed) {
    reasons.push(`amount ${amountWei} exceeds max ${maxAllowed.toString()}`);
  }

  if (action.kind === "transfer") {
    const recipient = action.recipient;
    if (!recipient) reasons.push("transfer missing recipient");
    else if (!config.recipientAllowlist.map(normalizeAddr).includes(normalizeAddr(recipient))) {
      reasons.push(`recipient ${recipient} not allowlisted`);
    }
  }

  if (input.lastSuccessAt && config.cooldownSeconds > 0) {
    const last = new Date(input.lastSuccessAt).getTime();
    const elapsed = (now.getTime() - last) / 1000;
    if (elapsed < config.cooldownSeconds) {
      reasons.push(`cooldown active (${Math.ceil(config.cooldownSeconds - elapsed)}s left)`);
    }
  }

  return { allowed: reasons.length === 0, reasons };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run tests/policy.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/policy.ts tests/policy.test.ts
git commit -m "feat: add policy gate with kill switch, limits, cooldown"
```

---

### Task 4: Audit store

**Files:**
- Create: `src/audit.ts`
- Test: `tests/audit.test.ts`

**Interfaces:**
- Produces: `AuditStore` with `append(record)`, `list(limit?)`, `lastSuccessAt()`, `get(id)`

- [ ] **Step 1: Write failing test**

```ts
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
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `src/audit.ts`**

```ts
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
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/audit.ts tests/audit.test.ts
git commit -m "feat: add JSONL audit store"
```

---

### Task 5: Decision engine (rules + optional LLM stub)

**Files:**
- Create: `src/decision.ts`
- Test: `tests/decision.test.ts`

**Interfaces:**
- Produces: `decide(observation, config, opts?): Promise<Decision>`

- [ ] **Step 1: Write failing tests**

```ts
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
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `src/decision.ts`**

```ts
import type { AppConfig, Decision, Observation } from "./types.js";

export interface LlmClient {
  chooseAction(input: {
    observation: Observation;
    candidateIds: string[];
    descriptions: Record<string, string>;
  }): Promise<{ actionId: string; rationale: string }>;
}

function thresholdBreached(o: Observation): boolean {
  if (o.metricValue === undefined || o.threshold === undefined || !o.thresholdDirection) {
    return false;
  }
  return o.thresholdDirection === "below"
    ? o.metricValue < o.threshold
    : o.metricValue > o.threshold;
}

export async function decide(
  observation: Observation,
  config: AppConfig,
  opts: { llm?: LlmClient | null } = {},
): Promise<Decision> {
  const breached = thresholdBreached(observation) || Boolean(observation.recentEvent);
  if (!breached) {
    return {
      actionId: "noop",
      rationale: "Metrics within threshold; no event requiring action.",
      fromRules: true,
    };
  }

  const candidates = config.allowedActions.filter((a) => a.kind !== "noop");
  if (candidates.length === 0) {
    return { actionId: "noop", rationale: "No non-noop actions configured.", fromRules: true };
  }

  if (opts.llm && config.llm?.enabled) {
    const descriptions = Object.fromEntries(candidates.map((c) => [c.id, c.description]));
    const chosen = await opts.llm.chooseAction({
      observation,
      candidateIds: candidates.map((c) => c.id),
      descriptions,
    });
    if (candidates.some((c) => c.id === chosen.actionId)) {
      return { ...chosen, fromRules: false };
    }
  }

  // Prefer protocol_action, else first candidate
  const preferred =
    candidates.find((c) => c.kind === "protocol_action") ?? candidates[0];
  return {
    actionId: preferred.id,
    rationale: `Rules: threshold/event trigger → ${preferred.description}`,
    fromRules: true,
  };
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/decision.ts tests/decision.test.ts
git commit -m "feat: add rules-first decision engine with optional LLM"
```

---

### Task 6: KeeperHub client interface + mock

**Files:**
- Create: `src/keeperhub/types.ts`, `src/keeperhub/client.ts`, `tests/fixtures/mock-keeperhub.ts`
- Test: `tests/keeperhub-client.test.ts`

**Interfaces:**
- Produces:

```ts
export interface ExecuteRequest {
  actionId: string;
  kind: ActionKind;
  protocolActionType?: string;
  amountWei: string;
  tokenAddress?: string;
  recipient?: string;
  chainId: ChainId;
}

export interface ExecuteHandle {
  executionId: string;
}

export interface ExecutionStatus {
  executionId: string;
  status: "pending" | "success" | "failed";
  txHash?: string;
  error?: string;
}

export interface KeeperHubClient {
  execute(req: ExecuteRequest): Promise<ExecuteHandle>;
  getStatus(executionId: string): Promise<ExecutionStatus>;
  executeAndWait(req: ExecuteRequest, opts?: { timeoutMs?: number }): Promise<ExecutionStatus>;
}
```

- [ ] **Step 1: Write failing test for mock wait**

```ts
import { describe, it, expect } from "vitest";
import { MockKeeperHubClient } from "./fixtures/mock-keeperhub.js";

describe("MockKeeperHubClient", () => {
  it("returns a tx hash after executeAndWait", async () => {
    const client = new MockKeeperHubClient();
    const status = await client.executeAndWait({
      actionId: "transfer-topup",
      kind: "transfer",
      amountWei: "1",
      recipient: "0x2",
      chainId: "sepolia",
    });
    expect(status.status).toBe("success");
    expect(status.txHash).toMatch(/^0x/);
  });
});
```

- [ ] **Step 2: Implement mock + real client skeleton**

`tests/fixtures/mock-keeperhub.ts`:

```ts
import { randomUUID } from "node:crypto";
import type {
  ExecuteRequest,
  ExecuteHandle,
  ExecutionStatus,
  KeeperHubClient,
} from "../../src/keeperhub/types.js";

export class MockKeeperHubClient implements KeeperHubClient {
  async execute(_req: ExecuteRequest): Promise<ExecuteHandle> {
    return { executionId: randomUUID() };
  }

  async getStatus(executionId: string): Promise<ExecutionStatus> {
    return {
      executionId,
      status: "success",
      txHash: `0x${"ab".repeat(32)}`,
    };
  }

  async executeAndWait(req: ExecuteRequest): Promise<ExecutionStatus> {
    if (req.kind === "noop") {
      return { executionId: "noop", status: "success" };
    }
    const { executionId } = await this.execute(req);
    return this.getStatus(executionId);
  }
}
```

`src/keeperhub/types.ts`: copy the interfaces above (import `ActionKind`, `ChainId` from `../types.js`).

`src/keeperhub/client.ts` (real MCP via HTTP JSON-RPC tools/call — keep minimal):

```ts
import type { ExecuteRequest, ExecuteHandle, ExecutionStatus, KeeperHubClient } from "./types.js";

export class HttpKeeperHubClient implements KeeperHubClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://app.keeperhub.com/mcp",
  ) {}

  private async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
    if (!res.ok) {
      throw new Error(`KeeperHub MCP HTTP ${res.status}: ${await res.text()}`);
    }
    const body = (await res.json()) as { result?: unknown; error?: { message: string } };
    if (body.error) throw new Error(body.error.message);
    return body.result;
  }

  async execute(req: ExecuteRequest): Promise<ExecuteHandle> {
    if (req.kind === "noop") return { executionId: "noop" };

    if (req.kind === "transfer") {
      const result = (await this.callTool("execute_transfer", {
        to: req.recipient,
        amount: req.amountWei,
        tokenAddress: req.tokenAddress,
      })) as { executionId?: string; id?: string };
      return { executionId: result.executionId ?? result.id ?? "unknown" };
    }

    if (req.kind === "protocol_action") {
      const result = (await this.callTool("execute_protocol_action", {
        actionType: req.protocolActionType,
        amount: req.amountWei,
      })) as { executionId?: string; id?: string };
      return { executionId: result.executionId ?? result.id ?? "unknown" };
    }

    const result = (await this.callTool("execute_check_and_execute", {
      amount: req.amountWei,
    })) as { executionId?: string; id?: string };
    return { executionId: result.executionId ?? result.id ?? "unknown" };
  }

  async getStatus(executionId: string): Promise<ExecutionStatus> {
    if (executionId === "noop") return { executionId, status: "success" };
    const result = (await this.callTool("get_direct_execution_status", {
      executionId,
    })) as {
      status?: string;
      txHash?: string;
      transactionHash?: string;
      error?: string;
    };
    const raw = (result.status ?? "pending").toLowerCase();
    const status =
      raw.includes("success") || raw.includes("complete")
        ? "success"
        : raw.includes("fail")
          ? "failed"
          : "pending";
    return {
      executionId,
      status,
      txHash: result.txHash ?? result.transactionHash,
      error: result.error,
    };
  }

  async executeAndWait(
    req: ExecuteRequest,
    opts: { timeoutMs?: number; pollMs?: number } = {},
  ): Promise<ExecutionStatus> {
    const timeoutMs = opts.timeoutMs ?? 120_000;
    const pollMs = opts.pollMs ?? 2_000;
    const { executionId } = await this.execute(req);
    if (executionId === "noop") return { executionId, status: "success" };
    const start = Date.now();
    for (;;) {
      const status = await this.getStatus(executionId);
      if (status.status !== "pending") return status;
      if (Date.now() - start > timeoutMs) {
        return { executionId, status: "failed", error: "timeout waiting for KeeperHub execution" };
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }
}

export function createKeeperHubClientFromEnv(): KeeperHubClient {
  const key = process.env.KEEPERHUB_API_KEY;
  if (!key) throw new Error("KEEPERHUB_API_KEY is required for live execution");
  return new HttpKeeperHubClient(key);
}
```

Note: During implementation, verify exact MCP tool argument names against `tools_documentation` / live `tools/list` and adjust `callTool` payloads accordingly (keep interface stable).

- [ ] **Step 4: Run mock test — PASS**

- [ ] **Step 5: Commit**

```bash
git add src/keeperhub tests/fixtures/mock-keeperhub.ts tests/keeperhub-client.test.ts
git commit -m "feat: add KeeperHub client interface, HTTP MCP client, and mock"
```

---

### Task 7: Agent core pipeline

**Files:**
- Create: `src/observe.ts`, `src/agent/core.ts`
- Test: `tests/agent-core.test.ts`

**Interfaces:**
- Produces: `runAgentCycle(input): Promise<AgentRunResult>`

```ts
export interface RunAgentCycleInput {
  trigger: TriggerKind;
  config: AppConfig;
  store: AuditStore;
  keeperhub: KeeperHubClient;
  observation?: Observation; // if omitted, observe() builds it
  llm?: LlmClient | null;
  amountWeiForAction?: string;
}
```

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runAgentCycle } from "../src/agent/core.js";
import { AuditStore } from "../src/audit.js";
import { loadConfig } from "../src/config.js";
import { MockKeeperHubClient } from "./fixtures/mock-keeperhub.js";

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
    expect(store.list(1)[0].id).toBe(result.audit.id);
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
    expect(result.audit.txHash).toMatch(/^0x/);
  });
});
```

- [ ] **Step 2: Implement observe + core**

`src/observe.ts` (read-only RPC balance; fine without KeeperHub):

```ts
import type { AppConfig, Observation } from "./types.js";

export async function observe(config: AppConfig): Promise<Observation> {
  let nativeBalanceWei = "0";
  try {
    const res = await fetch(config.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getBalance",
        params: [config.walletAddress, "latest"],
      }),
    });
    const body = (await res.json()) as { result?: string };
    if (body.result) nativeBalanceWei = BigInt(body.result).toString();
  } catch {
    // keep 0; guardian can still be demoed with injected observation
  }

  const eth = Number(BigInt(nativeBalanceWei)) / 1e18;
  return {
    at: new Date().toISOString(),
    chainId: config.chainId,
    walletAddress: config.walletAddress,
    nativeBalanceWei,
    metricName: config.guardian.metricName,
    metricValue: eth,
    threshold: config.guardian.threshold,
    thresholdDirection: config.guardian.thresholdDirection,
  };
}
```

`src/agent/core.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { AuditStore } from "../audit.js";
import { decide, type LlmClient } from "../decision.js";
import { evaluatePolicy } from "../policy.js";
import { observe } from "../observe.js";
import type { KeeperHubClient } from "../keeperhub/types.js";
import type {
  AgentRunResult,
  AppConfig,
  AuditRecord,
  Observation,
  TriggerKind,
} from "../types.js";

export interface RunAgentCycleInput {
  trigger: TriggerKind;
  config: AppConfig;
  store: AuditStore;
  keeperhub: KeeperHubClient;
  observation?: Observation;
  llm?: LlmClient | null;
  amountWeiForAction?: string;
}

export async function runAgentCycle(input: RunAgentCycleInput): Promise<AgentRunResult> {
  const observation = input.observation ?? (await observe(input.config));
  const decision = await decide(observation, input.config, { llm: input.llm ?? null });
  const action = input.config.allowedActions.find((a) => a.id === decision.actionId);
  if (!action) {
    const audit: AuditRecord = {
      id: randomUUID(),
      at: new Date().toISOString(),
      trigger: input.trigger,
      observation,
      decision,
      policy: { allowed: false, reasons: [`unknown action ${decision.actionId}`] },
      outcome: "failed",
      error: "unknown action",
    };
    input.store.append(audit);
    return { audit };
  }

  const amountWei = input.amountWeiForAction ?? action.maxAmountWei ?? "0";
  const policy = evaluatePolicy({
    config: input.config,
    decision,
    action,
    amountWei,
    lastSuccessAt: input.store.lastSuccessAt(),
  });

  if (!policy.allowed) {
    const audit: AuditRecord = {
      id: randomUUID(),
      at: new Date().toISOString(),
      trigger: input.trigger,
      observation,
      decision,
      policy,
      outcome: "blocked",
    };
    input.store.append(audit);
    return { audit };
  }

  if (action.kind === "noop") {
    const audit: AuditRecord = {
      id: randomUUID(),
      at: new Date().toISOString(),
      trigger: input.trigger,
      observation,
      decision,
      policy,
      outcome: "noop",
    };
    input.store.append(audit);
    return { audit };
  }

  try {
    const status = await input.keeperhub.executeAndWait({
      actionId: action.id,
      kind: action.kind,
      protocolActionType: action.protocolActionType,
      amountWei,
      tokenAddress: action.tokenAddress,
      recipient: action.recipient,
      chainId: input.config.chainId,
    });
    const audit: AuditRecord = {
      id: randomUUID(),
      at: new Date().toISOString(),
      trigger: input.trigger,
      observation,
      decision,
      policy,
      executionId: status.executionId,
      txHash: status.txHash,
      outcome: status.status === "success" ? "success" : "failed",
      error: status.error,
    };
    input.store.append(audit);
    return { audit };
  } catch (err) {
    const audit: AuditRecord = {
      id: randomUUID(),
      at: new Date().toISOString(),
      trigger: input.trigger,
      observation,
      decision,
      policy,
      outcome: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
    input.store.append(audit);
    return { audit };
  }
}
```

- [ ] **Step 3: Run — expect PASS**

- [ ] **Step 4: Commit**

```bash
git add src/observe.ts src/agent/core.ts tests/agent-core.test.ts
git commit -m "feat: add observe + runAgentCycle execution pipeline"
```

---

### Task 8: Guardian + event modes

**Files:**
- Create: `src/modes/guardian.ts`, `src/modes/events.ts`
- Test: `tests/guardian.test.ts`

**Interfaces:**
- Produces: `startGuardian(deps)`, `handleChainEvent(deps, event)`

- [ ] **Step 1: Tests — guardian invokes cycle on interval once**

```ts
import { describe, it, expect, vi } from "vitest";
import { runGuardianOnce } from "../src/modes/guardian.js";

describe("runGuardianOnce", () => {
  it("calls runCycle", async () => {
    const runCycle = vi.fn(async () => ({ audit: { id: "1" } }));
    await runGuardianOnce({ runCycle: runCycle as never });
    expect(runCycle).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Implement**

`src/modes/guardian.ts`:

```ts
import type { AgentRunResult } from "../types.js";

export async function runGuardianOnce(deps: {
  runCycle: () => Promise<AgentRunResult>;
}): Promise<AgentRunResult> {
  return deps.runCycle();
}

export function startGuardian(deps: {
  intervalSeconds: number;
  runCycle: () => Promise<AgentRunResult>;
  onError?: (err: unknown) => void;
}): { stop: () => void } {
  const tick = async () => {
    try {
      await runGuardianOnce(deps);
    } catch (err) {
      deps.onError?.(err);
    }
  };
  void tick();
  const handle = setInterval(tick, deps.intervalSeconds * 1000);
  return { stop: () => clearInterval(handle) };
}
```

`src/modes/events.ts`:

```ts
import type { Observation, AgentRunResult, AppConfig } from "../types.js";

export interface ChainEvent {
  name: string;
  txHash?: string;
  payload: Record<string, unknown>;
}

export async function handleChainEvent(deps: {
  config: AppConfig;
  event: ChainEvent;
  runCycle: (observation: Observation) => Promise<AgentRunResult>;
}): Promise<AgentRunResult> {
  const base: Observation = {
    at: new Date().toISOString(),
    chainId: deps.config.chainId,
    walletAddress: deps.config.walletAddress,
    nativeBalanceWei: "0",
    recentEvent: {
      name: deps.event.name,
      txHash: deps.event.txHash,
      payload: deps.event.payload,
    },
  };
  return deps.runCycle(base);
}
```

For v1 event ingestion: Express `POST /api/events/ingest` accepts a JSON event (simulates webhook / indexer) rather than a full websocket subscription — still satisfies “event responder” mode for the demo. Optional follow-up: poll `eth_getLogs`.

- [ ] **Step 3: Run tests — PASS + commit**

```bash
git add src/modes/guardian.ts src/modes/events.ts tests/guardian.test.ts
git commit -m "feat: add guardian and event-trigger modes"
```

---

### Task 9: x402 gateway helpers + paid route

**Files:**
- Create: `src/modes/x402.ts`
- Modify: (server in Task 10)
- Test: `tests/x402.test.ts`

**Interfaces:**
- Produces: `buildPaymentRequired(config)`, `hasValidPayment(headers, config)` (v1: shared-secret / mock verifier behind `X402_DEMO_BYPASS=1` for local demos; live verifier wired when KeeperHub agentic-wallet challenge format confirmed)

- [ ] **Step 1: Tests**

```ts
import { describe, it, expect } from "vitest";
import { buildPaymentRequired, hasValidPayment } from "../src/modes/x402.js";
import { loadConfig } from "../src/config.js";

describe("x402", () => {
  const config = loadConfig("config/default.json");

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
```

- [ ] **Step 2: Implement `src/modes/x402.ts`**

```ts
import type { AppConfig } from "../types.js";

export function buildPaymentRequired(config: AppConfig) {
  return {
    x402Version: 1,
    accepts: [
      {
        scheme: "exact",
        network: config.chainId,
        maxAmountRequired: config.x402.priceUsdc,
        resource: "/api/paid/run",
        payTo: config.x402.payTo,
        description: "Run Guardian agent cycle via KeeperHub",
      },
    ],
  };
}

export function hasValidPayment(
  headers: Record<string, string | string[] | undefined>,
  _config: AppConfig,
): boolean {
  const payment = headers["x-payment"] ?? headers["X-PAYMENT"];
  if (!payment) return false;
  if (process.env.X402_DEMO_BYPASS === "1" && String(payment) === "demo") return true;
  // Live path: verify signature / settlement against KeeperHub agentic wallet docs.
  // Until wired, require bypass only in local demo; production must set verifier.
  return Boolean(process.env.X402_PAYMENT_VERIFIER_URL);
}
```

During live integration: replace `hasValidPayment` with real challenge verification from https://docs.keeperhub.com/ai-tools/agentic-wallet (keep function signature).

- [ ] **Step 3: Commit**

```bash
git add src/modes/x402.ts tests/x402.test.ts
git commit -m "feat: add x402 payment challenge helpers"
```

---

### Task 10: Express server + CLI

**Files:**
- Create: `src/server.ts`, `src/cli.ts`
- Test: manual smoke via curl (document in README)

- [ ] **Step 1: Implement server**

```ts
import "dotenv/config";
import express from "express";
import { loadConfig } from "./config.js";
import { AuditStore } from "./audit.js";
import { runAgentCycle } from "./agent/core.js";
import { createKeeperHubClientFromEnv } from "./keeperhub/client.js";
import { MockKeeperHubClient } from "../tests/fixtures/mock-keeperhub.js";
import { startGuardian } from "./modes/guardian.js";
import { handleChainEvent } from "./modes/events.js";
import { buildPaymentRequired, hasValidPayment } from "./modes/x402.js";
import type { KeeperHubClient } from "./keeperhub/types.js";

const config = loadConfig();
const store = new AuditStore(process.env.AUDIT_PATH ?? "data/audit.jsonl");
const keeperhub: KeeperHubClient =
  process.env.KEEPERHUB_API_KEY && process.env.KEEPERHUB_MOCK !== "1"
    ? createKeeperHubClientFromEnv()
    : new MockKeeperHubClient();

const app = express();
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ ok: true, killSwitch: config.killSwitch }));

app.get("/api/status", (_req, res) => {
  res.json({
    chainId: config.chainId,
    walletAddress: config.walletAddress,
    killSwitch: config.killSwitch,
    lastSuccessAt: store.lastSuccessAt(),
    recent: store.list(5),
  });
});

app.get("/api/audit", (req, res) => {
  const limit = Number(req.query.limit ?? 50);
  res.json({ records: store.list(limit) });
});

app.post("/api/run", async (req, res) => {
  const result = await runAgentCycle({
    trigger: "manual",
    config,
    store,
    keeperhub,
    amountWeiForAction: req.body?.amountWei,
  });
  res.json(result);
});

app.post("/api/events/ingest", async (req, res) => {
  const result = await handleChainEvent({
    config,
    event: {
      name: req.body?.name ?? "CustomEvent",
      txHash: req.body?.txHash,
      payload: req.body?.payload ?? {},
    },
    runCycle: (observation) =>
      runAgentCycle({ trigger: "event", config, store, keeperhub, observation }),
  });
  res.json(result);
});

app.post("/api/paid/run", async (req, res) => {
  const headers = Object.fromEntries(
    Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  if (!hasValidPayment(headers, config)) {
    res.status(402).json(buildPaymentRequired(config));
    return;
  }
  const result = await runAgentCycle({
    trigger: "x402",
    config,
    store,
    keeperhub,
    amountWeiForAction: req.body?.amountWei,
  });
  res.json(result);
});

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => {
  console.log(`API on http://localhost:${port}`);
  if (process.env.GUARDIAN_AUTOSTART === "1") {
    startGuardian({
      intervalSeconds: config.guardian.intervalSeconds,
      runCycle: () => runAgentCycle({ trigger: "guardian", config, store, keeperhub }),
      onError: (err) => console.error("guardian error", err),
    });
    console.log("guardian autostart enabled");
  }
});
```

Install: `npm install express && npm install -D @types/express`

Move mock client to `src/keeperhub/mock.ts` (re-export from tests fixture path is awkward for production imports) — during this task, relocate `MockKeeperHubClient` to `src/keeperhub/mock.ts` and update tests to import from there.

- [ ] **Step 2: Implement CLI**

```ts
import "dotenv/config";
import { loadConfig } from "./config.js";
import { AuditStore } from "./audit.js";
import { runAgentCycle } from "./agent/core.js";
import { createKeeperHubClientFromEnv } from "./keeperhub/client.js";
import { MockKeeperHubClient } from "./keeperhub/mock.js";
import { startGuardian } from "./modes/guardian.js";

async function main() {
  const [cmd] = process.argv.slice(2);
  const config = loadConfig();
  const store = new AuditStore(process.env.AUDIT_PATH ?? "data/audit.jsonl");
  const keeperhub =
    process.env.KEEPERHUB_API_KEY && process.env.KEEPERHUB_MOCK !== "1"
      ? createKeeperHubClientFromEnv()
      : new MockKeeperHubClient();

  if (cmd === "status") {
    console.log(JSON.stringify({ lastSuccessAt: store.lastSuccessAt(), recent: store.list(5) }, null, 2));
    return;
  }
  if (cmd === "replay") {
    console.log(JSON.stringify(store.list(20), null, 2));
    return;
  }
  if (cmd === "watch") {
    startGuardian({
      intervalSeconds: config.guardian.intervalSeconds,
      runCycle: () => runAgentCycle({ trigger: "guardian", config, store, keeperhub }),
      onError: (e) => console.error(e),
    });
    console.log("watching… Ctrl+C to stop");
    return;
  }
  // default: run
  const result = await runAgentCycle({ trigger: "manual", config, store, keeperhub });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Smoke**

```bash
KEEPERHUB_MOCK=1 npm run cli -- run
KEEPERHUB_MOCK=1 npm run server
# other terminal:
curl -s localhost:8787/api/status | jq .
curl -s -X POST localhost:8787/api/run | jq .
curl -s -X POST localhost:8787/api/paid/run | jq .
# expect 402, then:
curl -s -X POST localhost:8787/api/paid/run -H 'x-payment: demo' -H 'Content-Type: application/json' 
# with X402_DEMO_BYPASS=1
```

- [ ] **Step 4: Commit**

```bash
git add src/server.ts src/cli.ts src/keeperhub/mock.ts package.json package-lock.json
git commit -m "feat: add Express API and CLI triggers"
```

---

### Task 11: Next.js demo UI

**Files:**
- Create: `apps/web/*`

- [ ] **Step 1: Scaffold**

```bash
cd /Users/dell/Downloads/Untitled
npx create-next-app@15 apps/web --ts --eslint --app --src-dir=false --tailwind=false --import-alias="@/*" --use-npm --turbopack=false
```

- [ ] **Step 2: API helper + page**

`apps/web/lib/api.ts`:

```ts
const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8787";

export async function getStatus() {
  const res = await fetch(`${BASE}/api/status`, { cache: "no-store" });
  if (!res.ok) throw new Error("status failed");
  return res.json();
}

export async function runNow() {
  const res = await fetch(`${BASE}/api/run`, { method: "POST" });
  if (!res.ok) throw new Error("run failed");
  return res.json();
}

export async function getAudit() {
  const res = await fetch(`${BASE}/api/audit?limit=20`, { cache: "no-store" });
  if (!res.ok) throw new Error("audit failed");
  return res.json();
}
```

`apps/web/app/page.tsx`: client component showing killSwitch, lastSuccessAt, Run now button, recent audit rows with tx links (`https://sepolia.etherscan.io/tx/${txHash}`).

Keep UI minimal: one column, clear status, no card spam.

- [ ] **Step 3: Manual check** — server + `npm run dev` in `apps/web`, click Run now, see audit row.

- [ ] **Step 4: Commit**

```bash
git add apps/web
git commit -m "feat: add thin Next.js dashboard for demo"
```

---

### Task 12: Live KeeperHub wiring + README submission pack

**Files:**
- Modify: `src/keeperhub/client.ts` (align tool args with live `tools/list`)
- Create: `README.md`
- Create: `docs/demo-script.md`

- [ ] **Step 1: Create KeeperHub account, org API key (`kh_`), fund Sepolia wallet if required**

- [ ] **Step 2: Call MCP `tools/list` / `tools_documentation` and fix `HttpKeeperHubClient` argument names until one real `execute_transfer` or protocol action succeeds on Sepolia**

- [ ] **Step 3: Record tx hash in README**

- [ ] **Step 4: Write README sections** — overview, architecture, setup, three modes, demo script, submission checklist (GitHub / video / tx link), env vars.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/demo-script.md src/keeperhub/client.ts
git commit -m "docs: add setup, demo script, and live KeeperHub notes"
```

---

## Spec coverage checklist

| Spec item | Task |
|---|---|
| Monolith observe→decide→policy→execute→audit | 7 |
| Guardian mode | 8 |
| Event mode | 8 + 10 ingest |
| x402 paid API | 9–10 |
| KeeperHub MCP execution | 6, 12 |
| Protocol action + transfer fallback | 1 config, 6 client, 5 decision preference |
| Policy / kill switch / cooldown | 3 |
| Audit trail | 4, 10, 11 |
| CLI + web UI | 10–11 |
| Sepolia first | config + README |
| Submission artifacts | 12 |

## Placeholder / consistency notes

- MCP HTTP `tools/call` shapes may need adjustment in Task 12 against live KeeperHub docs — interface `KeeperHubClient` stays stable.
- Relocate mock to `src/keeperhub/mock.ts` in Task 10 (explicit step).
- x402 live verification completed in Task 12; demo bypass is local-only.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-28-keeperhub-agents-onchain.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — run tasks in this session with executing-plans checkpoints  

Which approach?
