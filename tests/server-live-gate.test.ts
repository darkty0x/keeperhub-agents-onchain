import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { createApp } from "../src/server.js";
import { AuditStore } from "../src/audit.js";
import { loadConfig } from "../src/config.js";
import { MockKeeperHubClient } from "../src/keeperhub/mock.js";

describe("createApp mock write rejection", () => {
  const saved: Record<string, string | undefined> = {};
  let dir: string;
  let server: Server | undefined;

  afterEach(async () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  function stash(key: string) {
    if (!(key in saved)) saved[key] = process.env[key];
  }

  it("returns 503 on guardian run when production + mock", async () => {
    stash("NODE_ENV");
    stash("KEEPERHUB_MOCK");
    stash("REQUIRE_LIVE_KEEPERHUB");
    process.env.NODE_ENV = "production";
    process.env.KEEPERHUB_MOCK = "1";
    delete process.env.REQUIRE_LIVE_KEEPERHUB;

    dir = fs.mkdtempSync(path.join(os.tmpdir(), "srv-"));
    const config = loadConfig("config/default.json");
    const app = createApp({
      config,
      store: new AuditStore(path.join(dir, "a.jsonl")),
      keeperhub: new MockKeeperHubClient(),
      skipLiveGate: true,
    });

    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    const res = await fetch(`http://127.0.0.1:${addr.port}/api/guardian/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ forceBreach: true }),
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { submissionReady?: boolean };
    expect(body.submissionReady).toBe(false);
  });
});
