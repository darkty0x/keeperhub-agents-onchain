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
  llm: z
    .object({
      enabled: z.boolean(),
      baseUrl: z.string(),
      model: z.string(),
    })
    .optional(),
});

export function loadConfig(configPath = process.env.CONFIG_PATH ?? "config/default.json"): AppConfig {
  const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const parsed = AppConfigSchema.parse(raw) as AppConfig;
  const hasTransfer = parsed.allowedActions.some((a) => a.kind === "transfer");
  if (hasTransfer && parsed.recipientAllowlist.length === 0) {
    throw new Error("recipientAllowlist must be non-empty when transfer actions exist");
  }
  if (!parsed.chainAllowlist.includes(parsed.chainId)) {
    throw new Error(`chainId ${parsed.chainId} not in chainAllowlist`);
  }
  return parsed;
}
