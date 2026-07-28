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
  /** Prefer transfer over protocol_action for the first live Sepolia proof. */
  preferTransferFirst?: boolean;
  llm?: {
    enabled: boolean;
    baseUrl: string;
    model: string;
  };
}
