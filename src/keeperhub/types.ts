import type { ActionKind, ChainId } from "../types.js";

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
