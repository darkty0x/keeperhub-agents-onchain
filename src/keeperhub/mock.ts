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
      txHash: `0x${"ab".repeat(32)}`,
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
