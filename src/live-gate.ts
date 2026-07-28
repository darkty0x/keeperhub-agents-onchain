import type { AppConfig } from "./types.js";

const ZEROISH =
  /^0x0{38}(0[0-9a-f]|[1-9a-f][0-9a-f])$/i; // 0x000…0000 through 0x000…00ff style demo pads

/** True for zero address and the tiny demo placeholders (…0001 …0002 …0004). */
export function isPlaceholderAddress(address: string): boolean {
  const normalized = address.trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(normalized)) return true;
  if (normalized === "0x0000000000000000000000000000000000000000") return true;
  return ZEROISH.test(normalized);
}

/** Explicit go-live switch — process must not silently mock. */
export function requireLiveKeeperHubEnabled(): boolean {
  return process.env.REQUIRE_LIVE_KEEPERHUB === "1";
}

/** Production (or explicit live) must not accept mock writes as submission path. */
export function rejectMockWritesEnabled(): boolean {
  return (
    requireLiveKeeperHubEnabled() ||
    process.env.NODE_ENV === "production" ||
    process.env.REJECT_MOCK_WRITES === "1"
  );
}

export function isMockExecution(apiKey: string | undefined): boolean {
  return !(apiKey && process.env.KEEPERHUB_MOCK !== "1");
}

export class LiveKeeperHubRequiredError extends Error {
  readonly statusCode = 503;
  constructor(message: string) {
    super(message);
    this.name = "LiveKeeperHubRequiredError";
  }
}

/**
 * When REQUIRE_LIVE_KEEPERHUB=1, refuse to boot with mock/missing key.
 * Local `npm run server` without the flag still allows mock for unit demos.
 */
export function assertLiveExecutionAllowed(apiKey: string | undefined): void {
  if (!requireLiveKeeperHubEnabled()) return;
  if (process.env.KEEPERHUB_MOCK === "1") {
    throw new LiveKeeperHubRequiredError(
      "KEEPERHUB_MOCK=1 is forbidden when REQUIRE_LIVE_KEEPERHUB=1. " +
        "Delete KEEPERHUB_MOCK and set a real kh_ key — mocks are not submission-ready.",
    );
  }
  if (!apiKey) {
    throw new LiveKeeperHubRequiredError(
      "KEEPERHUB_API_KEY is required when REQUIRE_LIVE_KEEPERHUB=1. Create a kh_ key at app.keeperhub.com.",
    );
  }
}

/** Refuse placeholder watch/recipient addresses when live is required. */
export function assertLiveAddresses(config: AppConfig): void {
  if (!requireLiveKeeperHubEnabled()) return;
  if (isPlaceholderAddress(config.walletAddress)) {
    throw new LiveKeeperHubRequiredError(
      `walletAddress ${config.walletAddress} is a placeholder. Set WALLET_ADDRESS to a real Sepolia address.`,
    );
  }
  for (const recipient of config.recipientAllowlist) {
    if (isPlaceholderAddress(recipient)) {
      throw new LiveKeeperHubRequiredError(
        `recipientAllowlist entry ${recipient} is a placeholder. Set RECIPIENT_ADDRESS to a real address.`,
      );
    }
  }
  const transfer = config.allowedActions.find((a) => a.kind === "transfer");
  if (transfer?.recipient && isPlaceholderAddress(transfer.recipient)) {
    throw new LiveKeeperHubRequiredError(
      `transfer recipient ${transfer.recipient} is a placeholder. Update config or RECIPIENT_ADDRESS.`,
    );
  }
}

export function findLiveTxHash(
  records: { outcome: string; txHash?: string }[],
): string | null {
  const hit = records.find(
    (r) => r.outcome === "success" && Boolean(r.txHash) && !/mock/i.test(r.txHash ?? ""),
  );
  return hit?.txHash ?? (process.env.SUBMISSION_TX_HASH?.trim() || null);
}
