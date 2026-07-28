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

  // Prefer transfer for first live Sepolia proof when configured; else protocol_action.
  const preferred = config.preferTransferFirst
    ? (candidates.find((c) => c.kind === "transfer") ??
      candidates.find((c) => c.kind === "protocol_action") ??
      candidates[0])
    : (candidates.find((c) => c.kind === "protocol_action") ?? candidates[0]);
  if (!preferred) {
    throw new Error("no allowed actions available");
  }
  return {
    actionId: preferred.id,
    rationale: `Rules: threshold/event trigger → ${preferred.description}`,
    fromRules: true,
  };
}
