import { describe, it, expect } from "vitest";
import { MockKeeperHubClient } from "./fixtures/mock-keeperhub.js";

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
