import { describe, it, expect, vi, afterEach } from "vitest";
import { HttpKeeperHubClient } from "../src/keeperhub/client.js";
import { MockKeeperHubClient } from "../src/keeperhub/mock.js";

describe("HttpKeeperHubClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses MCP content envelope and returns executionId from execute()", async () => {
    const executionId = "exec-content-envelope-123";
    const fetchMock = vi.fn(async () =>
      Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: {
          content: [{ type: "text", text: JSON.stringify({ executionId }) }],
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new HttpKeeperHubClient("test-api-key");
    const handle = await client.execute({
      actionId: "transfer-topup",
      kind: "transfer",
      amountWei: "1000",
      recipient: "0xabc",
      chainId: "sepolia",
    });

    expect(handle.executionId).toBe(executionId);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.params.name).toBe("execute_transfer");
    expect(body.params.arguments).toMatchObject({
      network: "11155111",
      amount: "1000",
      to: "0xabc",
      recipientAddress: "0xabc",
    });
  });

  it("passes network + actionType for protocol actions", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: { content: [{ type: "text", text: JSON.stringify({ executionId: "p1" }) }] },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new HttpKeeperHubClient("test-api-key");
    await client.execute({
      actionId: "aave-withdraw-buffer",
      kind: "protocol_action",
      protocolActionType: "aave-v3/withdraw",
      amountWei: "50",
      chainId: "sepolia",
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.params.name).toBe("execute_protocol_action");
    expect(body.params.arguments).toEqual({
      network: "11155111",
      actionType: "aave-v3/withdraw",
      amount: "50",
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
