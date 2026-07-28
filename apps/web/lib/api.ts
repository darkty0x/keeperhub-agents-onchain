const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8787";

async function parseJson(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(
      typeof body?.error === "string" ? body.error : `request failed (${res.status})`,
    ) as Error & { status?: number; body?: unknown };
    error.status = res.status;
    error.body = body;
    throw error;
  }
  return body;
}

export async function getStatus() {
  const res = await fetch(`${BASE}/api/status`, { cache: "no-store" });
  return parseJson(res);
}

export async function getAudit(limit = 30) {
  const res = await fetch(`${BASE}/api/audit?limit=${limit}`, { cache: "no-store" });
  return parseJson(res);
}

export async function runManual(forceBreach = false) {
  const res = await fetch(`${BASE}/api/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ forceBreach }),
  });
  return parseJson(res);
}

export async function runGuardian(forceBreach = true) {
  const res = await fetch(`${BASE}/api/guardian/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ forceBreach }),
  });
  return parseJson(res);
}

export async function runEvent(payload?: {
  name?: string;
  txHash?: string;
  payload?: Record<string, unknown>;
}) {
  const res = await fetch(`${BASE}/api/events/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
  return parseJson(res);
}

export async function runPaid(opts?: { forceBreach?: boolean; payment?: string }) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts?.payment) headers["x-payment"] = opts.payment;
  const res = await fetch(`${BASE}/api/paid/run`, {
    method: "POST",
    headers,
    body: JSON.stringify({ forceBreach: opts?.forceBreach ?? true }),
  });
  if (res.status === 402) {
    const challenge = await res.json();
    const error = new Error("Payment required") as Error & {
      status?: number;
      body?: unknown;
    };
    error.status = 402;
    error.body = challenge;
    throw error;
  }
  return parseJson(res);
}
