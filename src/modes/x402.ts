import type { AppConfig } from "../types.js";

export function buildPaymentRequired(config: AppConfig) {
  return {
    x402Version: 1,
    accepts: [
      {
        scheme: "exact",
        network: config.chainId,
        maxAmountRequired: config.x402.priceUsdc,
        resource: "/api/paid/run",
        payTo: config.x402.payTo,
        description: "Run Guardian agent cycle via KeeperHub",
      },
    ],
  };
}

export function hasValidPayment(
  headers: Record<string, string | string[] | undefined>,
  _config: AppConfig,
): boolean {
  const payment = headers["x-payment"] ?? headers["X-PAYMENT"];
  if (!payment) return false;
  if (process.env.X402_DEMO_BYPASS === "1" && String(payment) === "demo") return true;
  // Live path: verify signature / settlement against KeeperHub agentic wallet docs.
  // Fail closed until real verifier is wired — VERIFIER_URL alone is not payment proof.
  return false;
}
