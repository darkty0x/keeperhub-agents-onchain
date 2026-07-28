"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

type X402Gate = {
  enabled?: boolean;
  endpoint?: string;
  paymentHeader?: string;
  version?: number;
  scheme?: string;
  network?: string;
  priceUsdc?: string;
  payTo?: string;
  resource?: string;
  demoBypass?: boolean;
  challenge?: {
    x402Version: number;
    accepts: Array<{
      scheme: string;
      network: string;
      maxAmountRequired: string;
      resource: string;
      payTo: string;
      description: string;
    }>;
  };
};

type AgentStatus = {
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
  x402?: X402Gate;
  observation?: AuditRecord["observation"] & { at?: string; chainId?: string };
  lastSuccessAt?: string | null;
  lastRun?: AuditRecord | null;
  submission?: { liveTxHash?: string | null };
};

type ModeId = "guardian" | "event" | "x402" | "observe";
type CycleStep = "observe" | "decide" | "policy" | "execute";

const MODES: { id: ModeId; title: string; blurb: string }[] = [
  { id: "guardian", title: "Guardian", blurb: "Watch balance, act on breach" },
  { id: "event", title: "Event", blurb: "Ingest event, then act" },
  { id: "x402", title: "x402", blurb: "HTTP 402 → same core" },
  { id: "observe", title: "Observe", blurb: "Read state only" },
];

const CYCLE_STEPS: { id: CycleStep; label: string }[] = [
  { id: "observe", label: "Observe" },
  { id: "decide", label: "Decide" },
  { id: "policy", label: "Policy" },
  { id: "execute", label: "Execute" },
];

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

function shortRationale(value?: string) {
  if (!value) return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 120) return cleaned;
  return `${cleaned.slice(0, 117)}…`;
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
        <button
          type="button"
          className={styles.copyBtn}
          onClick={() => void copy()}
          aria-label={`Copy ${label ?? "value"}`}
        >
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<AuditRecord | null>(null);
  const [paymentChallenge, setPaymentChallenge] = useState<unknown>(null);
  const [mode, setMode] = useState<ModeId>("guardian");
  const [cycleStep, setCycleStep] = useState<CycleStep>("execute");
  const [x402Paid, setX402Paid] = useState(false);

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

  useEffect(() => {
    if (!lastResult) return;
    if (lastResult.txHash && !isMockTx(lastResult.txHash)) {
      setCycleStep("execute");
    } else if (lastResult.policy && !lastResult.policy.allowed) {
      setCycleStep("policy");
    } else if (lastResult.decision?.actionId) {
      setCycleStep("decide");
    } else {
      setCycleStep("observe");
    }
  }, [lastResult]);

  async function startRun() {
    setBusy(true);
    setError(null);
    setPaymentChallenge(null);
    setCycleStep("observe");
    try {
      let result: { audit?: AuditRecord };
      if (mode === "guardian") {
        result = await runGuardian(true);
      } else if (mode === "event") {
        result = await runEvent({
          name: "Transfer",
          payload: {
            contract: status?.config?.events.contractAddress,
            signature: status?.config?.events.eventSignature,
          },
        });
      } else if (mode === "x402") {
        result = await runPaid({
          forceBreach: true,
          payment: x402Paid ? "demo" : undefined,
        });
      } else {
        result = await runManual(false);
      }
      if (result.audit) setLastResult(result.audit);
      await refresh();
    } catch (err) {
      const e = err as Error & { status?: number; body?: unknown };
      if (e.status === 402) {
        setPaymentChallenge(e.body);
        setError("Payment required");
        setCycleStep("policy");
      } else {
        setError(e.message || "Run failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  const cfg = status?.config;
  const x402 = status?.x402;
  const obs = lastResult?.observation ?? status?.observation;
  const mock = status?.execution?.mock;
  const liveTx =
    status?.submission?.liveTxHash ||
    records.find((r) => r.txHash && !isMockTx(r.txHash))?.txHash ||
    (lastResult?.txHash && !isMockTx(lastResult.txHash) ? lastResult.txHash : null);
  const wallet = cfg?.walletAddress;
  const challengePayload = paymentChallenge ?? x402?.challenge ?? null;
  const payTo = x402?.payTo ?? cfg?.x402.payTo;

  const stepIndex = CYCLE_STEPS.findIndex((s) => s.id === cycleStep);

  const runLabel = useMemo(() => {
    if (busy) return "Running…";
    if (mode === "guardian") return "Run guardian";
    if (mode === "event") return "Ingest event";
    if (mode === "x402") return x402Paid ? "Run with x-payment" : "Call unpaid (expect 402)";
    return "Observe";
  }, [busy, mode, x402Paid]);

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
            <span className={styles.pillOk}>x402</span>
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
            <HexLink large label="Watched wallet" value={wallet} href={explorerAddress(wallet)} />
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
            <strong>{weiToEth(status?.observation?.nativeBalanceWei ?? obs?.nativeBalanceWei)}</strong>
          </article>
          <article>
            <span>Threshold</span>
            <strong>
              {cfg?.guardian.threshold ?? "—"}
              <small> {cfg?.guardian.thresholdDirection ?? ""}</small>
            </strong>
          </article>
          <article>
            <span>Outcome</span>
            <strong className={styles.cap}>{lastResult?.outcome ?? "idle"}</strong>
          </article>
          <article>
            <span>Last success</span>
            <strong className={styles.time}>{formatDate(status?.lastSuccessAt)}</strong>
          </article>
        </section>

        <section className={styles.flow} aria-labelledby="flow-heading">
          <div className={styles.sectionHead}>
            <h2 id="flow-heading">1 · Choose mode</h2>
          </div>
          <div className={styles.modeGrid} role="listbox" aria-label="Agent mode">
            {MODES.map((item) => (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={mode === item.id}
                className={`${styles.modeCard} ${mode === item.id ? styles.modeActive : ""}`}
                onClick={() => setMode(item.id)}
              >
                <strong>{item.title}</strong>
                <span>{item.blurb}</span>
              </button>
            ))}
          </div>

          {mode === "x402" ? (
            <div className={styles.x402Panel} aria-label="x402 payment gate">
              <div className={styles.sectionHead}>
                <h3>x402 gate</h3>
                <p>Unpaid → HTTP 402 challenge · Paid header → same agent core</p>
              </div>
              <dl className={styles.x402Facts}>
                <div>
                  <dt>Endpoint</dt>
                  <dd className={styles.mono}>{x402?.endpoint ?? "POST /api/paid/run"}</dd>
                </div>
                <div>
                  <dt>Header</dt>
                  <dd className={styles.mono}>{x402?.paymentHeader ?? "x-payment"}</dd>
                </div>
                <div>
                  <dt>Version</dt>
                  <dd>x402 v{x402?.version ?? 1}</dd>
                </div>
                <div>
                  <dt>Scheme</dt>
                  <dd>{x402?.scheme ?? "exact"}</dd>
                </div>
                <div>
                  <dt>Price</dt>
                  <dd>{x402?.priceUsdc ?? cfg?.x402.priceUsdc ?? "—"} USDC</dd>
                </div>
                <div>
                  <dt>Network</dt>
                  <dd>{x402?.network ?? cfg?.chainId ?? "—"}</dd>
                </div>
                <div>
                  <dt>Resource</dt>
                  <dd className={styles.mono}>{x402?.resource ?? "/api/paid/run"}</dd>
                </div>
                <div>
                  <dt>Unlock</dt>
                  <dd>{x402?.demoBypass ? "x-payment: demo" : "Verified payment required"}</dd>
                </div>
              </dl>
              {payTo ? (
                <HexLink label="payTo" value={payTo} href={explorerAddress(payTo)} />
              ) : null}

              <div className={styles.payToggle} role="group" aria-label="Payment">
                <button
                  type="button"
                  className={!x402Paid ? styles.toggleOn : styles.toggleOff}
                  onClick={() => setX402Paid(false)}
                >
                  Unpaid → 402
                </button>
                <button
                  type="button"
                  className={x402Paid ? styles.toggleOn : styles.toggleOff}
                  onClick={() => setX402Paid(true)}
                >
                  Paid header
                </button>
              </div>

              {challengePayload != null ? (
                <div className={styles.challengeBlock}>
                  <span className={styles.hexLabel}>
                    {paymentChallenge ? "Live HTTP 402 body" : "Challenge shape"}
                  </span>
                  <pre className={styles.challenge}>{JSON.stringify(challengePayload, null, 2)}</pre>
                </div>
              ) : null}
            </div>
          ) : null}

          <button
            type="button"
            className={styles.primaryCta}
            disabled={busy || !status}
            onClick={() => void startRun()}
          >
            {runLabel}
          </button>

          {error ? <p className={styles.error}>{error}</p> : null}
        </section>

        <section className={styles.cycle} aria-labelledby="cycle-heading">
          <div className={styles.sectionHead}>
            <h2 id="cycle-heading">2 · Cycle</h2>
            {lastResult ? (
              <p>
                {lastResult.trigger} · {formatDate(lastResult.at)}
              </p>
            ) : (
              <p>Select a mode and run</p>
            )}
          </div>

          <div className={styles.stepRail} role="tablist" aria-label="Cycle steps">
            {CYCLE_STEPS.map((step, index) => {
              const done = Boolean(lastResult) && index < stepIndex;
              const active = cycleStep === step.id;
              return (
                <button
                  key={step.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`${styles.stepTab} ${active ? styles.stepActive : ""} ${done ? styles.stepDone : ""}`}
                  disabled={!lastResult && !busy}
                  onClick={() => setCycleStep(step.id)}
                >
                  <em>{index + 1}</em>
                  {step.label}
                </button>
              );
            })}
          </div>

          <div className={styles.stepPanel} role="tabpanel">
            {!lastResult && !busy ? (
              <p className={styles.muted}>Nothing to show yet.</p>
            ) : busy && !lastResult ? (
              <p className={styles.muted}>Observing…</p>
            ) : cycleStep === "observe" ? (
              <div className={styles.factGrid}>
                <div>
                  <span>Balance</span>
                  <strong>{weiToEth(obs?.nativeBalanceWei)}</strong>
                </div>
                <div>
                  <span>Metric</span>
                  <strong>
                    {obs?.metricValue?.toFixed?.(4) ?? "—"}
                    <small>
                      {" "}
                      / {obs?.threshold ?? cfg?.guardian.threshold ?? "—"}{" "}
                      {obs?.thresholdDirection ?? cfg?.guardian.thresholdDirection ?? ""}
                    </small>
                  </strong>
                </div>
                {obs?.walletAddress || wallet ? (
                  <div className={styles.factWide}>
                    <HexLink
                      label="Wallet"
                      value={(obs?.walletAddress || wallet)!}
                      href={explorerAddress((obs?.walletAddress || wallet)!)}
                    />
                  </div>
                ) : null}
              </div>
            ) : cycleStep === "decide" ? (
              <div className={styles.factGrid}>
                <div>
                  <span>Action</span>
                  <strong>{lastResult?.decision?.actionId ?? "—"}</strong>
                </div>
                <div>
                  <span>Source</span>
                  <strong>{lastResult?.decision?.fromRules ? "Rules" : "Model"}</strong>
                </div>
                {shortRationale(lastResult?.decision?.rationale) ? (
                  <div className={styles.factWide}>
                    <span>Why</span>
                    <p>{shortRationale(lastResult?.decision?.rationale)}</p>
                  </div>
                ) : null}
              </div>
            ) : cycleStep === "policy" ? (
              <div className={styles.factGrid}>
                <div>
                  <span>Result</span>
                  <strong className={lastResult?.policy?.allowed ? styles.ok : styles.warn}>
                    {lastResult?.policy?.allowed ? "Allowed" : "Blocked"}
                  </strong>
                </div>
                <div>
                  <span>Max amount</span>
                  <strong>{weiToEth(cfg?.maxAmountWei)}</strong>
                </div>
                <div>
                  <span>Kill switch</span>
                  <strong className={cfg?.killSwitch ? styles.warn : styles.ok}>
                    {cfg?.killSwitch ? "ON" : "OFF"}
                  </strong>
                </div>
                <div>
                  <span>Cooldown</span>
                  <strong>{cfg?.cooldownSeconds ?? "—"}s</strong>
                </div>
                {cfg?.recipientAllowlist?.[0] ? (
                  <div className={styles.factWide}>
                    <HexLink
                      label="Recipient"
                      value={cfg.recipientAllowlist[0]}
                      href={explorerAddress(cfg.recipientAllowlist[0])}
                    />
                  </div>
                ) : null}
                {lastResult?.policy?.reasons?.length ? (
                  <div className={styles.factWide}>
                    <span>Reasons</span>
                    <p>{lastResult.policy.reasons.join(" · ")}</p>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className={styles.factGrid}>
                <div>
                  <span>Outcome</span>
                  <strong className={styles.cap}>{lastResult?.outcome ?? "—"}</strong>
                </div>
                <div>
                  <span>Execution</span>
                  <strong className={styles.mono}>
                    {lastResult?.executionId
                      ? midEllipsis(lastResult.executionId, 10, 8)
                      : "—"}
                  </strong>
                </div>
                {lastResult?.txHash && !isMockTx(lastResult.txHash) ? (
                  <div className={styles.factWide}>
                    <HexLink
                      large
                      label="Transaction"
                      value={lastResult.txHash}
                      href={explorerTx(lastResult.txHash)}
                    />
                  </div>
                ) : (
                  <div className={styles.factWide}>
                    <span>Transaction</span>
                    <p className={styles.muted}>
                      {lastResult?.outcome === "noop"
                        ? "No transaction — conditions not met"
                        : lastResult?.error ?? "No transaction"}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {lastResult ? (
            <div className={styles.stepNav}>
              <button
                type="button"
                className={styles.navBtn}
                disabled={stepIndex <= 0}
                onClick={() => setCycleStep(CYCLE_STEPS[stepIndex - 1]!.id)}
              >
                Previous
              </button>
              <button
                type="button"
                className={styles.navBtn}
                disabled={stepIndex >= CYCLE_STEPS.length - 1}
                onClick={() => setCycleStep(CYCLE_STEPS[stepIndex + 1]!.id)}
              >
                Next
              </button>
            </div>
          ) : null}
        </section>

        <section className={styles.history} aria-labelledby="history-heading">
          <div className={styles.sectionHead}>
            <h2 id="history-heading">History</h2>
          </div>
          {records.length === 0 ? (
            <p className={styles.muted}>{loading ? "Loading…" : "No runs yet."}</p>
          ) : (
            <ul className={styles.historyList}>
              {records.map((record) => {
                const live = Boolean(record.txHash && !isMockTx(record.txHash));
                return (
                  <li key={record.id}>
                    <div className={styles.historyMeta}>
                      <span
                        className={`${styles.outcome} ${
                          record.outcome === "success"
                            ? styles.outcomeOk
                            : record.outcome === "error"
                              ? styles.outcomeBad
                              : styles.outcomeMute
                        }`}
                      >
                        {record.outcome}
                      </span>
                      <span className={styles.historyMode}>
                        {record.trigger}
                        {record.decision?.actionId ? ` · ${record.decision.actionId}` : ""}
                      </span>
                      <time>{formatDate(record.at)}</time>
                    </div>
                    {live && record.txHash ? (
                      <HexLink value={record.txHash} href={explorerTx(record.txHash)} label="Transaction" />
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
