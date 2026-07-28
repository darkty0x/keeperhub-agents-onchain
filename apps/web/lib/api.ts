const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8787";

export async function getStatus() {
  const res = await fetch(`${BASE}/api/status`, { cache: "no-store" });
  if (!res.ok) throw new Error("status failed");
  return res.json();
}

export async function runNow() {
  const res = await fetch(`${BASE}/api/run`, { method: "POST" });
  if (!res.ok) throw new Error("run failed");
  return res.json();
}

export async function getAudit() {
  const res = await fetch(`${BASE}/api/audit?limit=20`, { cache: "no-store" });
  if (!res.ok) throw new Error("audit failed");
  return res.json();
}
