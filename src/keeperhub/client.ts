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
    const statusOut: ExecutionStatus = { executionId, status };
    const txHash = result.txHash ?? result.transactionHash;
    if (txHash !== undefined) statusOut.txHash = txHash;
    if (result.error !== undefined) statusOut.error = result.error;
    return statusOut;
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
