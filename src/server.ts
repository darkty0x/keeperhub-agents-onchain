import "dotenv/config";
import express, { type Express } from "express";
import type { Server } from "node:http";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";
import { AuditStore } from "./audit.js";
import { runAgentCycle } from "./agent/core.js";
import { createKeeperHubClientFromEnv } from "./keeperhub/client.js";
import { MockKeeperHubClient } from "./keeperhub/mock.js";
import { startGuardian } from "./modes/guardian.js";
import { handleChainEvent } from "./modes/events.js";
import { buildPaymentRequired, hasValidPayment } from "./modes/x402.js";
import type { KeeperHubClient } from "./keeperhub/types.js";
import type { AppConfig } from "./types.js";

export interface ServerDependencies {
  config?: AppConfig;
  store?: AuditStore;
  keeperhub?: KeeperHubClient;
}

function createDependencies(deps: ServerDependencies) {
  const config = deps.config ?? loadConfig();
  const store = deps.store ?? new AuditStore(process.env.AUDIT_PATH ?? "data/audit.jsonl");
  const keeperhub =
    deps.keeperhub ??
    (process.env.KEEPERHUB_API_KEY && process.env.KEEPERHUB_MOCK !== "1"
      ? createKeeperHubClientFromEnv()
      : new MockKeeperHubClient());
  return { config, store, keeperhub };
}

export function createApp(deps: ServerDependencies = {}): Express {
  const { config, store, keeperhub } = createDependencies(deps);
  const app = express();
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, killSwitch: config.killSwitch });
  });

  app.get("/api/status", (_req, res) => {
    res.json({
      chainId: config.chainId,
      walletAddress: config.walletAddress,
      killSwitch: config.killSwitch,
      lastSuccessAt: store.lastSuccessAt(),
      recent: store.list(5),
    });
  });

  app.get("/api/audit", (req, res) => {
    const limit = Number(req.query.limit ?? 50);
    res.json({ records: store.list(Number.isFinite(limit) && limit >= 0 ? limit : 50) });
  });

  app.post("/api/run", async (req, res, next) => {
    try {
      const result = await runAgentCycle({
        trigger: "manual",
        config,
        store,
        keeperhub,
        amountWeiForAction: req.body?.amountWei,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/events/ingest", async (req, res, next) => {
    try {
      const result = await handleChainEvent({
        config,
        event: {
          name: req.body?.name ?? "CustomEvent",
          txHash: req.body?.txHash,
          payload: req.body?.payload ?? {},
        },
        runCycle: (observation) =>
          runAgentCycle({ trigger: "event", config, store, keeperhub, observation }),
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/paid/run", async (req, res, next) => {
    try {
      const headers = Object.fromEntries(
        Object.entries(req.headers).map(([key, value]) => [key.toLowerCase(), value]),
      );
      if (!hasValidPayment(headers, config)) {
        res.status(402).json(buildPaymentRequired(config));
        return;
      }
      const result = await runAgentCycle({
        trigger: "x402",
        config,
        store,
        keeperhub,
        amountWeiForAction: req.body?.amountWei,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  });

  return app;
}

export function startServer(port = Number(process.env.PORT ?? 8787), deps: ServerDependencies = {}): Server {
  const resolved = createDependencies(deps);
  const app = createApp(resolved);
  const { config, store, keeperhub } = resolved;
  let guardian: ReturnType<typeof startGuardian> | undefined;
  const server = app.listen(port, () => {
    console.log(`API on http://localhost:${port}`);
    if (process.env.GUARDIAN_AUTOSTART === "1") {
      guardian = startGuardian({
        intervalSeconds: config.guardian.intervalSeconds,
        runCycle: () => runAgentCycle({ trigger: "guardian", config, store, keeperhub }),
        onError: (err) => console.error("guardian error", err),
      });
      console.log("guardian autostart enabled");
    }
  });
  server.once("close", () => guardian?.stop());
  return server;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  startServer();
}
