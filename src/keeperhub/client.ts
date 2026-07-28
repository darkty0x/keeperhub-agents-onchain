import type { ChainId } from "../types.js";
import { networkIdForChain } from "./network.js";
import type { ExecuteRequest, ExecuteHandle, ExecutionStatus, KeeperHubClient } from "./types.js";

type McpContentBlock = { type?: string; text?: string };

// KeeperHub exposes these names through its remote MCP server. Keep the
// application-facing KeeperHubClient stable while live tool schemas evolve.
const TOOL_NAMES = {
  transfer: "execute_transfer",
  protocolAction: "execute_protocol_action",
  checkAndExecute: "execute_check_and_execute",
  status: "get_direct_execution_status",
  toolsDocumentation: "tools_documentation",
} as const;

function unwrapMcpToolResult(result: unknown): unknown {
  if (result === null || typeof result !== "object") {
    return result;
  }

  const envelope = result as {
    isError?: boolean;
    content?: McpContentBlock[];
    executionId?: string;
    id?: string;
  };

  if (envelope.isError) {
    const detail = envelope.content?.[0]?.text ?? "KeeperHub MCP tool returned an error";
    throw new Error(detail);
  }

  const text = envelope.content?.[0]?.text;
  if (typeof text === "string" && text.length > 0) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      // not JSON; fall through
    }
  }

  if ("executionId" in envelope || "id" in envelope) {
    return result;
  }

  return result;
}

function executionIdFrom(result: unknown): string {
  const r = result as { executionId?: string; id?: string } | null;
  return r?.executionId ?? r?.id ?? "unknown";
}

export class HttpKeeperHubClient implements KeeperHubClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = process.env.KEEPERHUB_MCP_URL ?? "https://app.keeperhub.com/mcp",
  ) {}

  /**
   * Sends one JSON-RPC MCP request (tools/call or tools/list).
   *
   * Before the first live run, prefer `npm run cli -- mcp-probe` so argument
   * names match the authenticated server's `tools/list` / `tools_documentation`.
   */
  private async rpc(method: string, params: Record<string, unknown>): Promise<unknown> {
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
        method,
        params,
      }),
    });
    if (!res.ok) {
      throw new Error(`KeeperHub MCP HTTP ${res.status}: ${await res.text()}`);
    }
    const body = (await res.json()) as { result?: unknown; error?: { message: string } };
    if (body.error) throw new Error(body.error.message);
    return body.result;
  }

  private async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return unwrapMcpToolResult(await this.rpc("tools/call", { name, arguments: args }));
  }

  /** List tools + schemas from the live MCP server (auth required). */
  async listTools(): Promise<unknown> {
    return this.rpc("tools/list", {});
  }

  async toolsDocumentation(): Promise<unknown> {
    return this.callTool(TOOL_NAMES.toolsDocumentation, {});
  }

  private transferArgs(req: ExecuteRequest): Record<string, unknown> {
    const network = networkIdForChain(req.chainId);
    // Wire mapping mirrors KeeperHub web3 transfer fields + direct-tool aliases.
    // Confirm with mcp-probe before treating as final for a new API revision.
    const args: Record<string, unknown> = {
      network,
      amount: req.amountWei,
      to: req.recipient,
      recipientAddress: req.recipient,
    };
    if (req.tokenAddress) {
      args.tokenAddress = req.tokenAddress;
    }
    return args;
  }

  private protocolArgs(req: ExecuteRequest): Record<string, unknown> {
    return {
      network: networkIdForChain(req.chainId),
      actionType: req.protocolActionType,
      amount: req.amountWei,
    };
  }

  async execute(req: ExecuteRequest): Promise<ExecuteHandle> {
    if (req.kind === "noop") return { executionId: "noop" };

    if (req.kind === "transfer") {
      const result = await this.callTool(TOOL_NAMES.transfer, this.transferArgs(req));
      return { executionId: executionIdFrom(result) };
    }

    if (req.kind === "protocol_action") {
      const result = await this.callTool(TOOL_NAMES.protocolAction, this.protocolArgs(req));
      return { executionId: executionIdFrom(result) };
    }

    const result = await this.callTool(TOOL_NAMES.checkAndExecute, {
      network: networkIdForChain(req.chainId),
      amount: req.amountWei,
    });
    return { executionId: executionIdFrom(result) };
  }

  async getStatus(executionId: string): Promise<ExecutionStatus> {
    if (executionId === "noop") return { executionId, status: "success" };
    const result = (await this.callTool(TOOL_NAMES.status, {
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

export function createKeeperHubClientFromEnv(
  apiKeyEnv = "KEEPERHUB_API_KEY",
): KeeperHubClient {
  const key = process.env[apiKeyEnv];
  if (!key) {
    throw new Error(`${apiKeyEnv} is required for live execution`);
  }
  return new HttpKeeperHubClient(key);
}

export function createHttpKeeperHubClientFromEnv(
  apiKeyEnv = "KEEPERHUB_API_KEY",
): HttpKeeperHubClient {
  const key = process.env[apiKeyEnv];
  if (!key) {
    throw new Error(`${apiKeyEnv} is required for live MCP probe`);
  }
  return new HttpKeeperHubClient(key);
}

export function summarizeToolsForProbe(toolsList: unknown, chainId: ChainId = "sepolia"): {
  network: string;
  toolNames: string[];
  focus: Record<string, unknown>;
} {
  const tools =
    (toolsList as { tools?: { name?: string; inputSchema?: unknown }[] })?.tools ??
    (Array.isArray(toolsList) ? (toolsList as { name?: string; inputSchema?: unknown }[]) : []);
  const names = tools.map((t) => t.name).filter((n): n is string => Boolean(n));
  const focusNames = [
    TOOL_NAMES.transfer,
    TOOL_NAMES.protocolAction,
    TOOL_NAMES.checkAndExecute,
    TOOL_NAMES.status,
  ];
  const focus: Record<string, unknown> = {};
  for (const name of focusNames) {
    const tool = tools.find((t) => t.name === name);
    focus[name] = tool?.inputSchema ?? (names.includes(name) ? "present (no schema)" : "MISSING");
  }
  return { network: networkIdForChain(chainId), toolNames: names, focus };
}
