import { describe, it, expect, vi, afterEach } from "vitest";
import { HttpKeeperHubClient, weiToHumanAmount } from "../src/keeperhub/client.js";
import { MockKeeperHubClient } from "../src/keeperhub/mock.js";

describe("weiToHumanAmount", () => {
  it("formats wei as eth decimal", () => {
    expect(weiToHumanAmount("1000000000000000")).toBe("0.001");
    expect(weiToHumanAmount("1000000000000000000")).toBe("1");
  });
});

describe("HttpKeeperHubClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("initializes MCP session then calls execute_transfer with live schema args", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { method?: string };
      if (body.method === "initialize") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: {} },
          }),
          { status: 200, headers: { "mcp-session-id": "sess-1" } },
        );
      }
      if (body.method === "notifications/initialized") {
        return new Response(null, { status: 202 });
      }
      if (body.method === "tools/call") {
        return Response.json({
          jsonrpc: "2.0",
          id: 2,
          result: {
            content: [{ type: "text", text: JSON.stringify({ executionId: "exec-1" }) }],
          },
        });
      }
      throw new Error(`unexpected ${body.method} for ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new HttpKeeperHubClient("test-api-key");
    const handle = await client.execute({
      actionId: "transfer-topup",
      kind: "transfer",
      amountWei: "1000000000000000",
      recipient: "0xabc",
      chainId: "sepolia",
    });

    expect(handle.executionId).toBe("exec-1");
    const callBodies = fetchMock.mock.calls.map((c) => JSON.parse(String(c[1]?.body)));
    expect(callBodies[0]?.method).toBe("initialize");
    expect(callBodies[1]?.method).toBe("notifications/initialized");
    expect(callBodies[2]?.params.name).toBe("execute_transfer");
    expect(callBodies[2]?.params.arguments).toMatchObject({
      chain_id: "11155111",
      to_address: "0xabc",
      amount: "0.001",
    });
    expect(fetchMock.mock.calls[2]?.[1]?.headers).toMatchObject({
      "Mcp-Session-Id": "sess-1",
    });
  });

  it("polls get_direct_execution_status with execution_id", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        method?: string;
        params?: { name?: string; arguments?: Record<string, unknown> };
      };
      if (body.method === "initialize") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), {
          status: 200,
          headers: { "mcp-session-id": "sess-2" },
        });
      }
      if (body.method === "notifications/initialized") {
        return new Response(null, { status: 202 });
      }
      if (body.params?.name === "get_direct_execution_status") {
        expect(body.params.arguments).toEqual({ execution_id: "exec-9" });
        return Response.json({
          jsonrpc: "2.0",
          id: 3,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  status: "success",
                  transactionHash: "0xdeadbeef",
                }),
              },
            ],
          },
        });
      }
      throw new Error(`unexpected ${JSON.stringify(body)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new HttpKeeperHubClient("test-api-key");
    const status = await client.getStatus("exec-9");
    expect(status).toEqual({
      executionId: "exec-9",
      status: "success",
      txHash: "0xdeadbeef",
    });
  });
});

describe("MockKeeperHubClient", () => {
  it("returns a tx hash after executeAndWait", async () => {
    const client = new MockKeeperHubClient();
    const status = await client.executeAndWait({
      actionId: "transfer-topup",
      kind: "transfer",
      amountWei: "1",
      recipient: "0x2",
      chainId: "sepolia",
    });
    expect(status.status).toBe("success");
    expect(status.txHash).toMatch(/^0xMOCK/i);
  });
});
