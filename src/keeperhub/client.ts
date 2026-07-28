import type { ChainId } from "../types.js";
import { networkIdForChain } from "./network.js";
import type { ExecuteRequest, ExecuteHandle, ExecutionStatus, KeeperHubClient } from "./types.js";

type McpContentBlock = { type?: string; text?: string };

const TOOL_NAMES = {
  transfer: "execute_transfer",
  protocolAction: "execute_protocol_action",
  checkAndExecute: "execute_check_and_execute",
  status: "get_direct_execution_status",
  toolsDocumentation: "tools_documentation",
} as const;

/** Convert wei integer string to human-readable ETH amount for KeeperHub transfer.amount. */
export function weiToHumanAmount(amountWei: string): string {
  const wei = BigInt(amountWei);
  const whole = wei / 10n ** 18n;
  const frac = wei % 10n ** 18n;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(18, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}

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
  const r = result as { executionId?: string; execution_id?: string; id?: string } | null;
  return r?.executionId ?? r?.execution_id ?? r?.id ?? "unknown";
}

export class HttpKeeperHubClient implements KeeperHubClient {
  private sessionId: string | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = process.env.KEEPERHUB_MCP_URL ?? "https://app.keeperhub.com/mcp",
  ) {}

  private headers(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...extra,
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
    return headers;
  }

  /**
   * Streamable HTTP MCP requires initialize → notifications/initialized
   * before tools/list or tools/call, with Mcp-Session-Id on later requests.
   */
  private async ensureSession(): Promise<void> {
    if (this.sessionId) return;
    if (this.initPromise) {
      await this.initPromise;
      return;
    }
    this.initPromise = (async () => {
      const initRes = await fetch(this.baseUrl, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: Date.now(),
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "keeperhub-agents-onchain", version: "1.0.0" },
          },
        }),
      });
      if (!initRes.ok) {
        throw new Error(`KeeperHub MCP initialize HTTP ${initRes.status}: ${await initRes.text()}`);
      }
      const sid = initRes.headers.get("mcp-session-id");
      if (!sid) {
        throw new Error("KeeperHub MCP initialize did not return mcp-session-id");
      }
      this.sessionId = sid;
      await initRes.json().catch(() => undefined);

      const notif = await fetch(this.baseUrl, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
          params: {},
        }),
      });
      if (!notif.ok && notif.status !== 202) {
        throw new Error(
          `KeeperHub MCP notifications/initialized HTTP ${notif.status}: ${await notif.text()}`,
        );
      }
    })();
    try {
      await this.initPromise;
    } catch (err) {
      this.sessionId = null;
      this.initPromise = null;
      throw err;
    }
  }

  private async rpc(method: string, params: Record<string, unknown>): Promise<unknown> {
    await this.ensureSession();
    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method,
        params,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      if (/session_not_initialized|Session not initialized/i.test(text)) {
        this.sessionId = null;
        this.initPromise = null;
      }
      throw new Error(`KeeperHub MCP HTTP ${res.status}: ${text}`);
    }
    const nextSid = res.headers.get("mcp-session-id");
    if (nextSid) this.sessionId = nextSid;
    const body = (await res.json()) as { result?: unknown; error?: { message: string } };
    if (body.error) throw new Error(body.error.message);
    return body.result;
  }

  private async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return unwrapMcpToolResult(await this.rpc("tools/call", { name, arguments: args }));
  }

  async listTools(): Promise<unknown> {
    return this.rpc("tools/list", {});
  }

  async toolsDocumentation(): Promise<unknown> {
    return this.callTool(TOOL_NAMES.toolsDocumentation, {});
  }

  private transferArgs(req: ExecuteRequest): Record<string, unknown> {
    const args: Record<string, unknown> = {
      chain_id: networkIdForChain(req.chainId),
      to_address: req.recipient,
      amount: weiToHumanAmount(req.amountWei),
      idempotency_key: `agents-onchain-${req.actionId}-${req.amountWei}`,
    };
    if (req.tokenAddress) args.token_address = req.tokenAddress;
    return args;
  }

  private protocolArgs(req: ExecuteRequest): Record<string, unknown> {
    return {
      actionType: req.protocolActionType,
      params: {
        network: networkIdForChain(req.chainId),
        amount: weiToHumanAmount(req.amountWei),
      },
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
      chain_id: networkIdForChain(req.chainId),
      amount: weiToHumanAmount(req.amountWei),
    });
    return { executionId: executionIdFrom(result) };
  }

  async getStatus(executionId: string): Promise<ExecutionStatus> {
    if (executionId === "noop") return { executionId, status: "success" };
    const result = (await this.callTool(TOOL_NAMES.status, {
      execution_id: executionId,
    })) as {
      status?: string;
      txHash?: string;
      transactionHash?: string | null;
      error?: string | null;
    };
    const raw = (result.status ?? "pending").toLowerCase();
    const status =
      raw.includes("success") || raw.includes("complete")
        ? "success"
        : raw.includes("fail")
          ? "failed"
          : "pending";
    const statusOut: ExecutionStatus = { executionId, status };
    const txHash = result.txHash ?? result.transactionHash ?? undefined;
    if (typeof txHash === "string" && txHash.length > 0) statusOut.txHash = txHash;
    if (typeof result.error === "string" && result.error.length > 0) statusOut.error = result.error;
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
