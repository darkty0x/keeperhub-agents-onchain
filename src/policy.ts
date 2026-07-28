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

const NON_NEGATIVE_WEI = /^\d+$/;

export function evaluatePolicy(input: PolicyInput): PolicyResult {
  const reasons: string[] = [];
  const { config, action, amountWei } = input;
  const now = input.now ?? new Date();

  if (typeof amountWei !== "string" || !NON_NEGATIVE_WEI.test(amountWei)) {
    return { allowed: false, reasons: ["invalid amountWei"] };
  }

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

  // Cooldown only gates writes; noop / observe paths stay allowed.
  if (action.kind !== "noop" && input.lastSuccessAt && config.cooldownSeconds > 0) {
    const last = new Date(input.lastSuccessAt).getTime();
    const elapsed = (now.getTime() - last) / 1000;
    if (elapsed < config.cooldownSeconds) {
      reasons.push(`cooldown active (${Math.ceil(config.cooldownSeconds - elapsed)}s left)`);
    }
  }

  return { allowed: reasons.length === 0, reasons };
}
