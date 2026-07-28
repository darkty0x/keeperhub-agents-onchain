import { randomUUID } from "node:crypto";
import type { AuditStore } from "../audit.js";
import { decide, type LlmClient } from "../decision.js";
import { observe } from "../observe.js";
import { evaluatePolicy } from "../policy.js";
import type { ExecuteRequest, KeeperHubClient } from "../keeperhub/types.js";
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
  const action = input.config.allowedActions.find((candidate) => candidate.id === decision.actionId);

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
    const request: ExecuteRequest = {
      actionId: action.id,
      kind: action.kind,
      amountWei,
      chainId: input.config.chainId,
    };
    if (action.protocolActionType !== undefined) request.protocolActionType = action.protocolActionType;
    if (action.tokenAddress !== undefined) request.tokenAddress = action.tokenAddress;
    if (action.recipient !== undefined) request.recipient = action.recipient;

    const status = await input.keeperhub.executeAndWait(request);
    const audit: AuditRecord = {
      id: randomUUID(),
      at: new Date().toISOString(),
      trigger: input.trigger,
      observation,
      decision,
      policy,
      executionId: status.executionId,
      outcome: status.status === "success" ? "success" : "failed",
    };
    if (status.txHash !== undefined) audit.txHash = status.txHash;
    if (status.error !== undefined) audit.error = status.error;
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
