"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getAudit,
  getStatus,
  runEvent,
  runGuardian,
  runManual,
  runPaid,
} from "../lib/api";
import styles from "./page.module.css";

type AllowedAction = {
  id: string;
  kind: string;
  description: string;
  protocolActionType?: string;
  maxAmountWei?: string;
  recipient?: string;
};

type AuditRecord = {
  id: string;
  at: string;
  trigger: string;
  outcome: string;
  txHash?: string;
  executionId?: string;
  error?: string;
  decision?: { actionId?: string; rationale?: string; fromRules?: boolean } | null;
  policy?: { allowed: boolean; reasons: string[] };
  observation?: {
    walletAddress?: string;
    nativeBalanceWei?: string;
    metricName?: string;
    metricValue?: number;
    threshold?: number;
    thresholdDirection?: string;
  };
};

type AgentStatus = {
  product?: { name: string; tagline: string };
  execution?: {
    mock: boolean;
    keeperhubMcp: string;
    chainId: string;
    networkId?: string;
  };
  config?: {
    chainId: string;
    walletAddress: string;
    killSwitch: boolean;
    maxAmountWei: string;
    recipientAllowlist: string[];
    chainAllowlist: string[];
    cooldownSeconds: number;
    guardian: {
      intervalSeconds: number;
      metricName: string;
      threshold: number;
      thresholdDirection: string;
    };
    events: { contractAddress: string; eventSignature: string };
    allowedActions: AllowedAction[];
    x402: { priceUsdc: string; payTo: string };
    preferTransferFirst?: boolean;
    llmEnabled: boolean;
  };
  observation?: AuditRecord["observation"] & { at?: string; chainId?: string };
  lastSuccessAt?: string | null;
  lastRun?: AuditRecord | null;
  submission?: { liveTxHash?: string | null };
};

function formatDate(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function weiToEth(wei?: string) {
  if (!wei) return "—";
  try {
    return `${(Number(BigInt(wei)) / 1e18).toFixed(6)} ETH`;
  } catch {
    return wei;
  }
}

function midEllipsis(value: string, head = 10, tail = 8) {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function isMockTx(txHash?: string) {
  return Boolean(txHash && /mock/i.test(txHash));
}

function explorerTx(hash: string) {
  return `https://sepolia.etherscan.io/tx/${hash}`;
}

function explorerAddress(address: string) {
  return `https://sepolia.etherscan.io/address/${address}`;
}

function HexLink({
  value,
  href,
  label,
  large = false,
}: {
  value: string;
  href: string;
  label?: string;
  large?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className={`${styles.hexRow} ${large ? styles.hexLarge : ""}`}>
      {label ? <span className={styles.hexLabel}>{label}</span> : null}
      <div className={styles.hexControls}>
        <a
          className={styles.hexLink}
          href={href}
          target="_blank"
          rel="noreferrer"
          title={value}
        >
          <span className={styles.hexFull}>{value}</span>
          <span className={styles.hexShort} aria-hidden="true">
            {midEllipsis(value, 14, 12)}
          </span>
        </a>
        <button type="button" className={styles.copyBtn} onClick={() => void copy()} aria-label={`Copy ${label ?? "value"}`}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export default function Home() {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<AuditRecord | null>(null);
  const [paymentChallenge, setPaymentChallenge] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextStatus, audit] = await Promise.all([getStatus(), getAudit(40)]);
      setStatus(nextStatus);
      setRecords(audit.records ?? []);
      if (nextStatus.lastRun) setLastResult(nextStatus.lastRun);
      setError(null);
    } catch {
      setError("Unable to reach the agent API.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(label: string, fn: () => Promise<{ audit?: AuditRecord }>) {
    setBusy(label);
    setError(null);
    setPaymentChallenge(null);
    try {
      const result = await fn();
      if (result.audit) setLastResult(result.audit);
      await refresh();
    } catch (err) {
      const e = err as Error & { status?: number; body?: unknown };
      if (e.status === 402) {
        setPaymentChallenge(e.body);
        setError("Payment required (HTTP 402).");
      } else {
        setError(e.message || "Run failed.");
      }
    } finally {
      setBusy(null);
    }
  }

  const cfg = status?.config;
  const obs = status?.observation;
  const mock = status?.execution?.mock;
  const liveTx =
    status?.submission?.liveTxHash ||
    records.find((r) => r.txHash && !isMockTx(r.txHash))?.txHash ||
    (lastResult?.txHash && !isMockTx(lastResult.txHash) ? lastResult.txHash : null);
  const wallet = cfg?.walletAddress;
  const actions = (cfg?.allowedActions ?? []).filter((a) => a.kind !== "noop");

  return (
    <div className={styles.shell}>
      <main className={styles.page}>
        <header className={styles.top}>
          <div>
            <p className={styles.brand}>
              Keeper<span>Hub</span>
            </p>
            <h1>Agents Onchain</h1>
          </div>
          <div className={styles.topRight}>
            {status == null ? (
              <span className={styles.pillMuted}>{loading ? "Connecting" : "Offline"}</span>
            ) : (
              <span className={mock ? styles.pillWarn : styles.pillOk}>
                {mock ? "Mock" : "Live"}
              </span>
            )}
            <span className={styles.pillMuted}>
              {(status?.execution?.chainId ?? "sepolia").toUpperCase()}
              {status?.execution?.networkId ? ` · ${status.execution.networkId}` : ""}
            </span>
          </div>
        </header>

        {error && !status && (
          <p className={styles.error}>
            {error}{" "}
            <button type="button" className={styles.textBtn} onClick={() => void refresh()}>
              Retry
            </button>
          </p>
        )}

        <section className={styles.identity} aria-label="Network identity">
          {wallet ? (
            <HexLink
              large
              label="Watched wallet"
              value={wallet}
              href={explorerAddress(wallet)}
            />
          ) : (
            <p className={styles.muted}>{loading ? "Loading…" : "No wallet configured"}</p>
          )}
          {liveTx ? (
            <HexLink large label="Latest transaction" value={liveTx} href={explorerTx(liveTx)} />
          ) : (
            <div className={styles.hexRow}>
              <span className={styles.hexLabel}>Latest transaction</span>
              <p className={styles.muted}>No transaction yet</p>
            </div>
          )}
        </section>

        <section className={styles.metrics} aria-label="Live metrics">
          <article>
            <span>Balance</span>
            <strong>{weiToEth(obs?.nativeBalanceWei)}</strong>
          </article>
          <article>
            <span>Metric</span>
            <strong>
              {obs?.metricValue?.toFixed?.(4) ?? "—"}
              <small>
                {" "}
                / {obs?.threshold ?? "—"} {obs?.thresholdDirection ?? ""}
              </small>
            </strong>
          </article>
          <article>
            <span>Last run</span>
            <strong className={styles.cap}>{lastResult?.outcome ?? "idle"}</strong>
          </article>
          <article>
            <span>Last success</span>
            <strong className={styles.time}>{formatDate(status?.lastSuccessAt)}</strong>
          </article>
        </section>

        <section className={styles.actions} aria-labelledby="run-heading">
          <div className={styles.sectionHead}>
            <h2 id="run-heading">Run</h2>
          </div>
          <div className={styles.runGrid}>
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void run("guardian", () => runGuardian(true))}
            >
              {busy === "guardian" ? "Running…" : "Guardian"}
            </button>
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() =>
                void run("event", () =>
                  runEvent({
                    name: "Transfer",
                    payload: {
                      contract: cfg?.events.contractAddress,
                      signature: cfg?.events.eventSignature,
                    },
                  }),
                )
              }
            >
              {busy === "event" ? "Running…" : "Event"}
            </button>
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void run("x402-unpaid", () => runPaid({ forceBreach: true }))}
            >
              {busy === "x402-unpaid" ? "…" : "x402 unpaid"}
            </button>
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() =>
                void run("x402-paid", () => runPaid({ forceBreach: true, payment: "demo" }))
              }
            >
              {busy === "x402-paid" ? "Running…" : "x402 paid"}
            </button>
            <button
              type="button"
              className={styles.secondary}
              disabled={Boolean(busy)}
              onClick={() => void run("manual", () => runManual(false))}
            >
              {busy === "manual" ? "Running…" : "Observe"}
            </button>
          </div>
          {error && <p className={styles.error}>{error}</p>}
          {paymentChallenge != null && (
            <pre className={styles.challenge}>{JSON.stringify(paymentChallenge, null, 2)}</pre>
          )}
        </section>

        <section className={styles.twoCol}>
          <div>
            <div className={styles.sectionHead}>
              <h2>Policy</h2>
            </div>
            <dl className={styles.kv}>
              <div>
                <dt>Kill switch</dt>
                <dd className={cfg?.killSwitch ? styles.warn : styles.ok}>
                  {cfg?.killSwitch ? "ON" : "OFF"}
                </dd>
              </div>
              <div>
                <dt>Max amount</dt>
                <dd>{weiToEth(cfg?.maxAmountWei)}</dd>
              </div>
              <div>
                <dt>Cooldown</dt>
                <dd>{cfg?.cooldownSeconds ?? "—"}s</dd>
              </div>
              <div>
                <dt>Decision</dt>
                <dd>{cfg?.preferTransferFirst ? "Transfer first" : "Protocol first"}</dd>
              </div>
            </dl>
            {cfg?.recipientAllowlist?.[0] ? (
              <HexLink
                label="Allowlisted recipient"
                value={cfg.recipientAllowlist[0]}
                href={explorerAddress(cfg.recipientAllowlist[0])}
              />
            ) : null}
          </div>

          <div>
            <div className={styles.sectionHead}>
              <h2>Actions</h2>
            </div>
            <ul className={styles.actionList}>
              {actions.map((action) => (
                <li key={action.id}>
                  <div className={styles.actionTitle}>
                    <strong>{action.id}</strong>
                    <span>{action.kind.replace(/_/g, " ")}</span>
                  </div>
                  <p>
                    {action.description
                      .replace(/\s*\(Sepolia proof\)/i, "")
                      .replace(/\s*\(first live proof\)/i, "")}
                      .trim()}
                  </p>
                  <p className={styles.muted}>max {weiToEth(action.maxAmountWei)}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {lastResult && (
          <section className={styles.last} aria-labelledby="last-heading">
            <div className={styles.sectionHead}>
              <h2 id="last-heading">Last cycle</h2>
              <p>
                {lastResult.trigger} · {formatDate(lastResult.at)}
              </p>
            </div>
            <div className={styles.lastGrid}>
              <div>
                <span>Decision</span>
                <strong>{lastResult.decision?.actionId ?? "—"}</strong>
              </div>
              <div>
                <span>Policy</span>
                <strong>{lastResult.policy?.allowed ? "Allowed" : "Blocked"}</strong>
              </div>
              <div>
                <span>Outcome</span>
                <strong className={styles.cap}>{lastResult.outcome}</strong>
              </div>
            </div>
            {lastResult.txHash && !isMockTx(lastResult.txHash) ? (
              <HexLink
                large
                label="Transaction"
                value={lastResult.txHash}
                href={explorerTx(lastResult.txHash)}
              />
            ) : null}
            {lastResult.error ? <p className={styles.error}>{lastResult.error}</p> : null}
          </section>
        )}

        <section className={styles.audit} aria-labelledby="audit-heading">
          <div className={styles.sectionHead}>
            <h2 id="audit-heading">Activity</h2>
          </div>
          {records.length === 0 ? (
            <p className={styles.muted}>{loading ? "Loading…" : "No runs yet."}</p>
          ) : (
            <ul className={styles.activity}>
              {records.map((record) => {
                const live = Boolean(record.txHash && !isMockTx(record.txHash));
                return (
                  <li key={record.id}>
                    <div className={styles.activityHead}>
                      <strong className={styles.cap}>{record.outcome}</strong>
                      <span>
                        {record.trigger}
                        {record.decision?.actionId ? ` · ${record.decision.actionId}` : ""}
                      </span>
                      <time>{formatDate(record.at)}</time>
                    </div>
                    {live && record.txHash ? (
                      <HexLink value={record.txHash} href={explorerTx(record.txHash)} />
                    ) : (
                      <p className={styles.muted}>
                        {record.outcome === "noop"
                          ? "No transaction"
                          : record.error ?? "No transaction"}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
