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

  it("blocks writes during cooldown", () => {
    const cfg = { ...config(), cooldownSeconds: 120 };
    const action = cfg.allowedActions.find((a) => a.id === "transfer-topup")!;
    const result = evaluatePolicy({
      config: cfg,
      decision: { actionId: action.id, rationale: "test", fromRules: true },
      action,
      amountWei: "1",
      lastSuccessAt: new Date().toISOString(),
      now: new Date(),
    });
    expect(result.allowed).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/cooldown/i);
  });

  it("allows noop during cooldown", () => {
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
    expect(result.allowed).toBe(true);
  });

  it("blocks negative amountWei without throwing", () => {
    const cfg = config();
    const action = cfg.allowedActions.find((a) => a.id === "transfer-topup")!;
    const result = evaluatePolicy({
      config: cfg,
      decision: { actionId: action.id, rationale: "test", fromRules: true },
      action,
      amountWei: "-1",
    });
    expect(result.allowed).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/invalid amountWei/i);
  });

  it("blocks non-string amountWei without throwing", () => {
    const cfg = config();
    const action = cfg.allowedActions.find((a) => a.id === "transfer-topup")!;
    const result = evaluatePolicy({
      config: cfg,
      decision: { actionId: action.id, rationale: "test", fromRules: true },
      action,
      amountWei: 1 as unknown as string,
    });
    expect(result.allowed).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/invalid amountWei/i);
  });

  it("blocks Symbol amountWei without throwing", () => {
    const cfg = config();
    const action = cfg.allowedActions.find((a) => a.id === "transfer-topup")!;
    const result = evaluatePolicy({
      config: cfg,
      decision: { actionId: action.id, rationale: "test", fromRules: true },
      action,
      amountWei: Symbol("x") as unknown as string,
    });
    expect(result.allowed).toBe(false);
    expect(result.reasons).toEqual(["invalid amountWei"]);
  });

  it("blocks malformed amountWei without throwing", () => {
    const cfg = config();
    const action = cfg.allowedActions.find((a) => a.id === "transfer-topup")!;
    for (const amountWei of ["abc", "1.5", "12e3"]) {
      const result = evaluatePolicy({
        config: cfg,
        decision: { actionId: action.id, rationale: "test", fromRules: true },
        action,
        amountWei,
      });
      expect(result.allowed).toBe(false);
      expect(result.reasons.join(" ")).toMatch(/invalid amountWei/i);
    }
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
