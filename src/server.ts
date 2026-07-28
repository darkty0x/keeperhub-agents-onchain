import "dotenv/config";
import express, { type Express } from "express";
import type { Server } from "node:http";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";
import { AuditStore } from "./audit.js";
import { runAgentCycle } from "./agent/core.js";
import { observe } from "./observe.js";
import { createKeeperHubClientFromEnv } from "./keeperhub/client.js";
import { networkIdForChain } from "./keeperhub/network.js";
import { MockKeeperHubClient } from "./keeperhub/mock.js";
import { startGuardian } from "./modes/guardian.js";
import { handleChainEvent } from "./modes/events.js";
import { buildPaymentRequired, hasValidPayment } from "./modes/x402.js";
import {
  assertLiveAddresses,
  assertLiveExecutionAllowed,
  findLiveTxHash,
  isMockExecution,
  LiveKeeperHubRequiredError,
  rejectMockWritesEnabled,
  requireLiveKeeperHubEnabled,
} from "./live-gate.js";
import type { KeeperHubClient } from "./keeperhub/types.js";
import type { AppConfig, Observation } from "./types.js";

export interface ServerDependencies {
  config?: AppConfig;
  store?: AuditStore;
  keeperhub?: KeeperHubClient;
  /** When true, skip live-gate asserts (unit tests only). */
  skipLiveGate?: boolean;
}

function createDependencies(deps: ServerDependencies) {
  const config = deps.config ?? loadConfig();
  const store = deps.store ?? new AuditStore(process.env.AUDIT_PATH ?? "data/audit.jsonl");
  const apiKeyEnv = config.keeperhubApiKeyEnv;
  const apiKey = process.env[apiKeyEnv];

  if (!deps.skipLiveGate) {
    assertLiveExecutionAllowed(apiKey);
    assertLiveAddresses(config);
  }

  const mock = isMockExecution(apiKey);
  if (requireLiveKeeperHubEnabled() && mock && !deps.skipLiveGate) {
    throw new LiveKeeperHubRequiredError("Live mode cannot use MockKeeperHubClient");
  }

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
    preferTransferFirst: Boolean(config.preferTransferFirst),
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
  return Boolean(findLiveTxHash(store.list(200)));
}

function rejectMockWrites(mock: boolean): express.RequestHandler {
  return (_req, res, next) => {
    if (rejectMockWritesEnabled() && mock) {
      res.status(503).json({
        error:
          "Write endpoints disabled while mock is on. Set KEEPERHUB_API_KEY, delete KEEPERHUB_MOCK, set real WALLET_ADDRESS/RECIPIENT_ADDRESS, then REQUIRE_LIVE_KEEPERHUB=1.",
        submissionReady: false,
      });
      return;
    }
    next();
  };
}

export function createApp(deps: ServerDependencies = {}): Express {
  const { config, store, keeperhub, mock } = createDependencies(deps);
  const app = express();
  app.use(corsMiddleware);
  app.use(express.json());

  const liveTxHash = () => findLiveTxHash(store.list(200));

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      killSwitch: config.killSwitch,
      mock,
      requireLive: requireLiveKeeperHubEnabled(),
      submissionReady: !mock && hasLiveTx(store),
    });
  });

  app.get("/api/status", async (_req, res, next) => {
    try {
      const observation = await observe(config);
      const recent = store.list(8);
      const lastRun = recent[0] ?? null;
      const liveHash = liveTxHash();
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
          keeperhubMcp: process.env.KEEPERHUB_MCP_URL ?? "https://app.keeperhub.com/mcp",
          chainId: config.chainId,
          networkId: networkIdForChain(config.chainId),
          signer: "KeeperHub org Turnkey wallet (not MetaMask in this UI)",
          watchedAddressLabel: "Watched address (RPC observe target)",
        },
        deploy: {
          api: process.env.PUBLIC_API_URL ?? null,
          web: process.env.PUBLIC_WEB_URL ?? "https://web-production-a79e1.up.railway.app",
          hackathon: "https://dorahacks.io/hackathon/agents-onchain",
          demoScript: "docs/demo-script.md",
          goLive: "docs/go-live.md",
        },
        config: publicConfig(config),
        observation,
        lastSuccessAt: store.lastSuccessAt(),
        lastRun,
        recent,
        goLive: {
          blockedOn: mock
            ? [
                "NOT READY: mock mode cannot be judged — DoraHacks requires a real KeeperHub tx",
                "Set KEEPERHUB_API_KEY (kh_…) and delete KEEPERHUB_MOCK",
                "Fund Sepolia on the KeeperHub org wallet that signs txs",
                "Set WALLET_ADDRESS + RECIPIENT_ADDRESS to that wallet (or an allowlisted recipient)",
                "Set REQUIRE_LIVE_KEEPERHUB=1, run mcp-probe / live-submit, verify on Sepolia Etherscan",
              ]
            : liveHash
              ? [
                  `Live KeeperHub tx recorded: ${liveHash}`,
                  "Record the ~2 minute video with the explorer link visible",
                  "Publish GitHub + submit BUIDL on DoraHacks",
                ]
              : [
                  `Fund Sepolia ETH to ${config.walletAddress} (balance is currently insufficient for transfer)`,
                  "Use https://sepolia-faucet.pk910.de/ (PoW faucet) — Alchemy/Google need mainnet ETH",
                  "Then run Guardian breach or: npm run live-submit",
                  "Verify on Sepolia Etherscan, set SUBMISSION_TX_HASH, update README",
                ],
        },
        submission: {
          ready: !mock && Boolean(liveHash),
          mockBlocksSubmission: mock,
          githubReady: true,
          liveTxReady: Boolean(liveHash),
          liveTxHash: liveHash,
          demoVideoReady: false,
          checklist: [
            {
              id: "keeperhub-live",
              label: "Live KeeperHub MCP (not mock)",
              done: !mock,
            },
            { id: "modes", label: "Guardian + event + x402 modes", done: true },
            { id: "audit", label: "Audit trail + policy gate", done: true },
            { id: "ui", label: "Demo dashboard with all modes", done: true },
            {
              id: "live-tx",
              label: "Real Sepolia tx hash via KeeperHub",
              done: Boolean(liveHash),
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

  const blockMock = rejectMockWrites(mock);

  app.post("/api/run", blockMock, async (req, res, next) => {
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

  app.post("/api/guardian/run", blockMock, async (req, res, next) => {
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

  app.post("/api/events/ingest", blockMock, async (req, res, next) => {
    try {
      const result = await handleChainEvent({
        config,
        event: {
          name: req.body?.name ?? config.events.eventSignature.split("(")[0] ?? "Transfer",
          txHash: req.body?.txHash,
          payload: req.body?.payload ?? {
            contract: config.events.contractAddress,
            signature: config.events.eventSignature,
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

  app.post("/api/paid/run", blockMock, async (req, res, next) => {
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
    if (err instanceof LiveKeeperHubRequiredError) {
      res.status(err.statusCode).json({ error: err.message, submissionReady: false });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  });

  return app;
}

export function startServer(port = Number(process.env.PORT ?? 8787), deps: ServerDependencies = {}): Server {
  let resolved: ReturnType<typeof createDependencies>;
  try {
    resolved = createDependencies(deps);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
  const { config, store, keeperhub, mock } = resolved;
  const app = createApp({
    config,
    store,
    keeperhub,
    skipLiveGate: true,
  });
  let guardian: ReturnType<typeof startGuardian> | undefined;
  const server = app.listen(port, () => {
    console.log(`API on http://localhost:${port} mock=${mock} requireLive=${requireLiveKeeperHubEnabled()}`);
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
