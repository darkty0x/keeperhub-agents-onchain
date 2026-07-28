import fs from "node:fs";
import { z } from "zod";
import type { AppConfig } from "./types.js";

const AllowedActionSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["protocol_action", "check_and_execute", "transfer", "noop"]),
  protocolActionType: z.string().optional(),
  description: z.string(),
  maxAmountWei: z.string().optional(),
  tokenAddress: z.string().optional(),
  recipient: z.string().optional(),
});

const AppConfigSchema = z.object({
  chainId: z.enum(["sepolia", "ethereum", "base"]),
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  rpcUrl: z.string().url(),
  keeperhubApiKeyEnv: z.string().min(1),
  killSwitch: z.boolean(),
  maxAmountWei: z.string().regex(/^\d+$/),
  recipientAllowlist: z.array(z.string()),
  chainAllowlist: z.array(z.enum(["sepolia", "ethereum", "base"])).min(1),
  cooldownSeconds: z.number().int().nonnegative(),
  guardian: z.object({
    intervalSeconds: z.number().int().positive(),
    metricName: z.string(),
    threshold: z.number(),
    thresholdDirection: z.enum(["below", "above"]),
  }),
  events: z.object({
    contractAddress: z.string(),
    eventSignature: z.string(),
  }),
  allowedActions: z.array(AllowedActionSchema).min(1),
  x402: z.object({
    priceUsdc: z.string(),
    payTo: z.string(),
  }),
  preferTransferFirst: z.boolean().optional(),
  llm: z
    .object({
      enabled: z.boolean(),
      baseUrl: z.string(),
      model: z.string(),
    })
    .optional(),
});

function applyEnvOverrides(config: AppConfig): AppConfig {
  const next: AppConfig = {
    ...config,
    allowedActions: config.allowedActions.map((a) => ({ ...a })),
    recipientAllowlist: [...config.recipientAllowlist],
  };

  const wallet = process.env.WALLET_ADDRESS?.trim();
  if (wallet) next.walletAddress = wallet;

  const recipient = process.env.RECIPIENT_ADDRESS?.trim();
  if (recipient) {
    next.recipientAllowlist = [recipient];
    for (const action of next.allowedActions) {
      if (action.kind === "transfer") action.recipient = recipient;
    }
  }

  const rpc = process.env.RPC_URL?.trim();
  if (rpc) next.rpcUrl = rpc;

  if (process.env.PREFER_TRANSFER_FIRST === "1") {
    next.preferTransferFirst = true;
  }
  if (process.env.PREFER_TRANSFER_FIRST === "0") {
    next.preferTransferFirst = false;
  }

  const maxWei = process.env.MAX_AMOUNT_WEI?.trim();
  if (maxWei) next.maxAmountWei = maxWei;

  const payTo = process.env.X402_PAY_TO?.trim();
  if (payTo) next.x402 = { ...next.x402, payTo };

  return next;
}

export function loadConfig(configPath = process.env.CONFIG_PATH ?? "config/default.json"): AppConfig {
  const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const parsed = AppConfigSchema.parse(raw) as AppConfig;
  const config = applyEnvOverrides(parsed);
  const hasTransfer = config.allowedActions.some((a) => a.kind === "transfer");
  if (hasTransfer && config.recipientAllowlist.length === 0) {
    throw new Error("recipientAllowlist must be non-empty when transfer actions exist");
  }
  if (!config.chainAllowlist.includes(config.chainId)) {
    throw new Error(`chainId ${config.chainId} not in chainAllowlist`);
  }
  return config;
}
