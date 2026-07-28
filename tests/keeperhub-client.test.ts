import { describe, it, expect, vi, afterEach } from "vitest";
import { HttpKeeperHubClient } from "../src/keeperhub/client.js";
import { MockKeeperHubClient } from "./fixtures/mock-keeperhub.js";

describe("HttpKeeperHubClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses MCP content envelope and returns executionId from execute()", async () => {
    const executionId = "exec-content-envelope-123";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: {
            content: [{ type: "text", text: JSON.stringify({ executionId }) }],
          },
        }),
      ),
    );

    const client = new HttpKeeperHubClient("test-api-key");
    const handle = await client.execute({
      actionId: "transfer-topup",
      kind: "transfer",
      amountWei: "1000",
      recipient: "0xabc",
      chainId: "sepolia",
    });

    expect(handle.executionId).toBe(executionId);
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
    expect(status.txHash).toMatch(/^0x/);
  });
});
