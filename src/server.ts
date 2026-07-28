import "dotenv/config";
import express, { type Express } from "express";
import type { Server } from "node:http";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";
import { AuditStore } from "./audit.js";
import { runAgentCycle } from "./agent/core.js";
import { observe } from "./observe.js";
import { createKeeperHubClientFromEnv } from "./keeperhub/client.js";
import { MockKeeperHubClient } from "./keeperhub/mock.js";
import { startGuardian } from "./modes/guardian.js";
import { handleChainEvent } from "./modes/events.js";
import { buildPaymentRequired, hasValidPayment } from "./modes/x402.js";
import type { KeeperHubClient } from "./keeperhub/types.js";
import type { AppConfig, Observation } from "./types.js";

export interface ServerDependencies {
  config?: AppConfig;
  store?: AuditStore;
  keeperhub?: KeeperHubClient;
}

function isMockExecution(apiKey: string | undefined): boolean {
  return !(apiKey && process.env.KEEPERHUB_MOCK !== "1");
}

function createDependencies(deps: ServerDependencies) {
  const config = deps.config ?? loadConfig();
  const store = deps.store ?? new AuditStore(process.env.AUDIT_PATH ?? "data/audit.jsonl");
  const apiKeyEnv = config.keeperhubApiKeyEnv;
  const apiKey = process.env[apiKeyEnv];
  const mock = isMockExecution(apiKey);
  const keeperhub =
    deps.keeperhub ??
    (mock ? new MockKeeperHubClient() : createKeeperHubClientFromEnv(apiKeyEnv));
  return { config, store, keeperhub, mock };
}

function allowedCorsOrigins(): string[] {
  const origins = new Set<string>(["http://localhost:3000"]);
  const webOrigin = process.env.NEXT_PUBLIC_WEB_ORIGIN?.trim();
  if (webOrigin) origins.add(webOrigin);
  const extra = process.env.WEB_ORIGINS?.split(",") ?? [];
  for (const origin of extra) {
    const trimmed = origin.trim();
    if (trimmed) origins.add(trimmed);
  }
  return [...origins];
}

function corsMiddleware(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const origin = req.headers.origin;
  if (origin && allowedCorsOrigins().includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-payment");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
}

function publicConfig(config: AppConfig) {
  return {
    chainId: config.chainId,
    walletAddress: config.walletAddress,
    rpcUrl: config.rpcUrl,
    killSwitch: config.killSwitch,
    maxAmountWei: config.maxAmountWei,
    recipientAllowlist: config.recipientAllowlist,
    chainAllowlist: config.chainAllowlist,
    cooldownSeconds: config.cooldownSeconds,
    guardian: config.guardian,
    events: config.events,
    allowedActions: config.allowedActions,
    x402: config.x402,
    llmEnabled: Boolean(config.llm?.enabled),
  };
}

function breachObservation(base: Observation, config: AppConfig): Observation {
  const threshold = config.guardian.threshold;
  const metricValue =
    config.guardian.thresholdDirection === "below" ? threshold / 2 : threshold * 2;
  return {
    ...base,
    metricName: config.guardian.metricName,
    metricValue,
    threshold,
    thresholdDirection: config.guardian.thresholdDirection,
  };
}

function hasLiveTx(store: AuditStore): boolean {
  return store.list(200).some(
    (r) => r.outcome === "success" && Boolean(r.txHash) && !/mock/i.test(r.txHash ?? ""),
  );
}

export function createApp(deps: ServerDependencies = {}): Express {
  const { config, store, keeperhub, mock } = createDependencies(deps);
  const app = express();
  app.use(corsMiddleware);
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, killSwitch: config.killSwitch, mock });
  });

  app.get("/api/status", async (_req, res, next) => {
    try {
      const observation = await observe(config);
      const recent = store.list(8);
      const lastRun = recent[0] ?? null;
      res.json({
        product: {
          name: "KeeperHub Agents Onchain",
          tagline: "AI agents that finish the last mile onchain",
          hackathon: "https://dorahacks.io/hackathon/agents-onchain",
          docs: "https://docs.keeperhub.com/",
        },
        modes: [
          {
            id: "guardian",
            title: "Guardian",
            persona: "Solo DeFi user",
            description: "Watch wallet/position thresholds and act when breached.",
            endpoint: "POST /api/guardian/run",
          },
          {
            id: "event",
            title: "Event responder",
            persona: "Protocol / ops team",
            description: "Ingest a contract event, decide, execute, and audit.",
            endpoint: "POST /api/events/ingest",
          },
          {
            id: "x402",
            title: "Paid agent API",
            persona: "Other agents",
            description: "Pay via x402 challenge, then run the same execution core.",
            endpoint: "POST /api/paid/run",
          },
        ],
        execution: {
          mock,
          keeperhubMcp: "https://app.keeperhub.com/mcp",
          chainId: config.chainId,
        },
        config: publicConfig(config),
        observation,
        lastSuccessAt: store.lastSuccessAt(),
        lastRun,
        recent,
        submission: {
          githubReady: true,
          liveTxReady: hasLiveTx(store),
          demoVideoReady: false,
          checklist: [
            { id: "keeperhub", label: "KeeperHub execution layer", done: true },
            { id: "modes", label: "Guardian + event + x402 modes", done: true },
            { id: "audit", label: "Audit trail + policy gate", done: true },
            { id: "ui", label: "Demo dashboard with all modes", done: true },
            {
              id: "live-tx",
              label: "Real Sepolia tx via KeeperHub (not mock)",
              done: hasLiveTx(store),
            },
            { id: "video", label: "Demo video recorded", done: false },
          ],
        },
      });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/audit", (req, res) => {
    const limit = Number(req.query.limit ?? 50);
    res.json({ records: store.list(Number.isFinite(limit) && limit >= 0 ? limit : 50) });
  });

  app.get("/api/observe", async (_req, res, next) => {
    try {
      res.json({ observation: await observe(config) });
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/run", async (req, res, next) => {
    try {
      const forceBreach = Boolean(req.body?.forceBreach);
      const base = await observe(config);
      const observation = forceBreach ? breachObservation(base, config) : base;
      const result = await runAgentCycle({
        trigger: "manual",
        config,
        store,
        keeperhub,
        observation,
        amountWeiForAction: req.body?.amountWei,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/guardian/run", async (req, res, next) => {
    try {
      const forceBreach = req.body?.forceBreach !== false;
      const base = await observe(config);
      const observation = forceBreach ? breachObservation(base, config) : base;
      const result = await runAgentCycle({
        trigger: "guardian",
        config,
        store,
        keeperhub,
        observation,
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
          name: req.body?.name ?? config.events.eventSignature.split("(")[0] ?? "Transfer",
          txHash: req.body?.txHash,
          payload: req.body?.payload ?? {
            contract: config.events.contractAddress,
            signature: config.events.eventSignature,
            demo: true,
          },
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
      const forceBreach = Boolean(req.body?.forceBreach);
      const base = await observe(config);
      const result = await runAgentCycle({
        trigger: "x402",
        config,
        store,
        keeperhub,
        ...(forceBreach ? { observation: breachObservation(base, config) } : {}),
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
