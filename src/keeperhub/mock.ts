import { randomUUID } from "node:crypto";
import type {
  ExecuteRequest,
  ExecuteHandle,
  ExecutionStatus,
  KeeperHubClient,
} from "./types.js";

export class MockKeeperHubClient implements KeeperHubClient {
  async execute(_req: ExecuteRequest): Promise<ExecuteHandle> {
    return { executionId: randomUUID() };
  }

  async getStatus(executionId: string): Promise<ExecutionStatus> {
    return {
      executionId,
      status: "success",
      // Deliberately non-explorer hash; UI treats `MOCK` as local-only.
      txHash: `0xMOCK${randomUUID().replace(/-/g, "").toLowerCase()}`.slice(0, 66),
    };
  }

  async executeAndWait(req: ExecuteRequest): Promise<ExecutionStatus> {
    if (req.kind === "noop") {
      return { executionId: "noop", status: "success" };
    }
    const { executionId } = await this.execute(req);
    return this.getStatus(executionId);
  }
}
