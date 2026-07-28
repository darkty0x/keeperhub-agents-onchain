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
