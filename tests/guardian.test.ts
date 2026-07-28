import { describe, it, expect, vi } from "vitest";
import { runGuardianOnce } from "../src/modes/guardian.js";

describe("runGuardianOnce", () => {
  it("calls runCycle", async () => {
    const runCycle = vi.fn(async () => ({ audit: { id: "1" } }));
    await runGuardianOnce({ runCycle: runCycle as never });
    expect(runCycle).toHaveBeenCalledTimes(1);
  });
});
