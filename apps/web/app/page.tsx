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

type Mode = {
  id: string;
  title: string;
  persona: string;
  description: string;
  endpoint: string;
};

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
    recentEvent?: { name: string; payload?: Record<string, unknown> };
  };
};

type DemoStatus = {
  product?: { name: string; tagline: string; hackathon: string; docs: string };
  modes?: Mode[];
  execution?: {
    mock: boolean;
    keeperhubMcp: string;
    chainId: string;
    networkId?: string;
    signer?: string;
    watchedAddressLabel?: string;
  };
  deploy?: {
    api?: string | null;
    web?: string | null;
    hackathon?: string;
    demoScript?: string;
    goLive?: string;
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
  goLive?: { blockedOn: string[] };
  submission?: {
    ready?: boolean;
    mockBlocksSubmission?: boolean;
    liveTxReady: boolean;
    liveTxHash?: string | null;
    demoVideoReady: boolean;
    checklist: { id: string; label: string; done: boolean }[];
  };
};

function formatDate(value?: string | null) {
  if (!value) return "Never";
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

function shortAddr(address?: string) {
  if (!address || address.length < 12) return address ?? "—";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function isMockTx(txHash?: string) {
  if (!txHash) return false;
  return /mock/i.test(txHash);
}

function txLabel(record: Pick<AuditRecord, "outcome" | "txHash" | "error" | "decision">) {
  if (record.outcome === "noop") {
    return "noop — no tx (healthy metrics)";
  }
  if (record.txHash) {
    return isMockTx(record.txHash) ? "mock tx (not explorers)" : shortAddr(record.txHash);
  }
  if (record.outcome === "blocked") return "blocked — no tx";
  return record.error ?? "no tx";
}

export default function Home() {
  const [status, setStatus] = useState<DemoStatus | null>(null);
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<AuditRecord | null>(null);
  const [paymentChallenge, setPaymentChallenge] = useState<unknown>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

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
        setError("x402 payment required — unpaid requests never execute. Retry with demo payment.");
      } else {
        setError(e.message || "Run failed.");
      }
    } finally {
      setBusy(null);
    }
  }

  const cfg = status?.config;
  const obs = status?.observation;
  const mock = status?.execution?.mock ?? true;

  return (
    <div className={styles.shell}>
      <main className={styles.page}>
        <header className={styles.brand}>
          <p className={styles.brandMark}>
            Keeper<span>Hub</span>
          </p>
          <p className={styles.brandMeta}>Agents Onchain · submission demo</p>
        </header>

        <section className={styles.hero}>
          <h1>{status?.product?.tagline ?? "AI agents that finish the last mile onchain."}</h1>
          <p className={styles.lede}>
            One execution core, three triggers (guardian, event, paid x402). Observe → decide →
            policy → KeeperHub MCP → audit. DoraHacks judges require a <strong>real</strong> Sepolia
            transaction through KeeperHub — mock hashes are rejected for submission.
          </p>
          {mock && (
            <p className={styles.notReady} role="status">
              NOT READY FOR SUBMISSION — running MOCK KeeperHub. Set a real <code>kh_</code> API key
              and disable mock before recording the demo or filing the BUIDL.
            </p>
          )}
          {!mock && status?.submission?.ready && (
            <p className={styles.readyBanner} role="status">
              Live KeeperHub tx recorded — still need demo video + public GitHub for full submission.
            </p>
          )}
          <div className={styles.heroLinks}>
            <a href={status?.product?.hackathon ?? "https://dorahacks.io/hackathon/agents-onchain"} target="_blank" rel="noreferrer">
              Hackathon brief
            </a>
            <a href={status?.product?.docs ?? "https://docs.keeperhub.com/"} target="_blank" rel="noreferrer">
              KeeperHub docs
            </a>
            <a href="https://docs.keeperhub.com/ai-tools/mcp-server" target="_blank" rel="noreferrer">
              MCP server
            </a>
          </div>
        </section>

        <section className={styles.checklist} aria-labelledby="checklist-heading">
          <div className={styles.sectionHead}>
            <h2 id="checklist-heading">Submission readiness</h2>
            <p className={mock ? styles.badgeMock : styles.badgeLive}>
              {mock
                ? "NOT SUBMISSION READY"
                : status?.submission?.ready
                  ? "LIVE + TX RECORDED"
                  : "LIVE — awaiting first tx"}
            </p>
          </div>
          <ul className={styles.checkList}>
            {(status?.submission?.checklist ?? []).map((item) => (
              <li key={item.id} className={item.done ? styles.checkDone : styles.checkTodo}>
                <span>{item.done ? "Done" : "Todo"}</span>
                {item.label}
              </li>
            ))}
            {loading && <li className={styles.checkTodo}>Loading checklist…</li>}
          </ul>
          <dl className={styles.execMeta}>
            <div>
              <dt>MCP</dt>
              <dd>{status?.execution?.keeperhubMcp ?? "https://app.keeperhub.com/mcp"}</dd>
            </div>
            <div>
              <dt>Chain</dt>
              <dd>
                {status?.execution?.chainId ?? "sepolia"}
                {status?.execution?.networkId ? ` · ${status.execution.networkId}` : ""}
              </dd>
            </div>
            <div>
              <dt>Submission tx</dt>
              <dd>
                {status?.submission?.liveTxHash ? (
                  <a
                    href={`https://sepolia.etherscan.io/tx/${status.submission.liveTxHash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {shortAddr(status.submission.liveTxHash)}
                  </a>
                ) : (
                  "None yet"
                )}
              </dd>
            </div>
          </dl>
          <dl className={styles.execMeta}>
            <div>
              <dt>Watched address (RPC)</dt>
              <dd>{shortAddr(cfg?.walletAddress)}</dd>
            </div>
            <div>
              <dt>Execution signer</dt>
              <dd>
                {status?.execution?.signer ??
                  "KeeperHub org Turnkey wallet (not MetaMask in this UI)"}
              </dd>
            </div>
            <div>
              <dt>Last success</dt>
              <dd>{formatDate(status?.lastSuccessAt)}</dd>
            </div>
          </dl>
          {error && loading === false && status === null && (
            <p className={styles.error}>
              {error}{" "}
              <button type="button" className={styles.linkBtn} onClick={() => void refresh()}>
                Retry
              </button>
            </p>
          )}
        </section>

        <section className={styles.golive} aria-labelledby="golive-heading">
          <div className={styles.sectionHead}>
            <h2 id="golive-heading">Go live for judging</h2>
            <p>
              {mock
                ? "Mock is local wiring only. Do not submit until this badge is LIVE and a real tx exists."
                : "Live MCP is on — run a mode, open the explorer link, then record the video."}
            </p>
          </div>
          <ol className={styles.goList}>
            {(status?.goLive?.blockedOn ?? [
              "Create a KeeperHub org API key (kh_…)",
              "Fund / connect a Sepolia wallet in KeeperHub",
              "Set KEEPERHUB_API_KEY and disable KEEPERHUB_MOCK",
              "Probe MCP schemas, run one mode, paste the tx hash into README",
            ]).map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>

        <section className={styles.pipeline} aria-label="Pipeline">
          <article className={styles.step}>
            <span className={styles.stepIndex}>01 Observe</span>
            <strong>{obs?.metricName ?? "nativeBalanceEth"}</strong>
            <p>
              {obs?.metricValue?.toFixed?.(6) ?? "—"} / threshold {obs?.threshold ?? "—"} (
              {obs?.thresholdDirection ?? "below"}) · {weiToEth(obs?.nativeBalanceWei)}
            </p>
          </article>
          <article className={styles.step}>
            <span className={styles.stepIndex}>02 Decide + policy</span>
            <strong>{lastResult?.decision?.actionId ?? "waiting"}</strong>
            <p>
              {lastResult?.decision?.rationale ??
                "Rules pick an allowlisted action; policy enforces kill switch, limits, cooldown."}
            </p>
          </article>
          <article className={styles.step}>
            <span className={styles.stepIndex}>03 Execute</span>
            <strong>{lastResult?.outcome ?? "idle"}</strong>
            <p>
              {lastResult?.txHash
                ? isMockTx(lastResult.txHash)
                  ? "Mock hash (not explorers)"
                  : shortAddr(lastResult.txHash)
                : lastResult?.outcome === "noop"
                  ? "noop — healthy metrics, no KeeperHub call"
                  : "No tx yet — run guardian breach below."}
            </p>
          </article>
        </section>

        <section className={styles.modes} aria-labelledby="modes-heading">
          <div className={styles.sectionHead}>
            <h2 id="modes-heading">Three modes · same core</h2>
            <p>
              Primary path: Guardian breach (tiny transfer when live). Manual observe often noops
              when the watched address is healthy — that is expected, not a wallet bug.
            </p>
          </div>
          <div className={styles.modeGrid}>
            <article className={styles.modeCard}>
              <p className={styles.modePersona}>Solo DeFi user</p>
              <h3>Guardian</h3>
              <p>
                Watches the RPC address every {cfg?.guardian.intervalSeconds ?? 30}s. Demo run
                injects a threshold breach so policy can allow a write through KeeperHub.
              </p>
              <ul>
                <li>
                  Metric: {cfg?.guardian.metricName} {cfg?.guardian.thresholdDirection}{" "}
                  {cfg?.guardian.threshold}
                </li>
                <li>Watched address: {shortAddr(cfg?.walletAddress)}</li>
                <li>Signer: KeeperHub org wallet</li>
              </ul>
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void run("guardian", () => runGuardian(true))}
              >
                {busy === "guardian" ? "Running…" : "Run guardian breach"}
              </button>
            </article>

            <article className={styles.modeCard}>
              <p className={styles.modePersona}>Protocol / ops</p>
              <h3>Event responder</h3>
              <p>
                Ingest a contract event, attach it to the observation, decide, and execute.
              </p>
              <ul>
                <li>Contract: {shortAddr(cfg?.events.contractAddress)}</li>
                <li>Event: {cfg?.events.eventSignature}</li>
              </ul>
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
                        demo: true,
                      },
                    }),
                  )
                }
              >
                {busy === "event" ? "Running…" : "Ingest demo event"}
              </button>
            </article>

            <article className={styles.modeCard}>
              <p className={styles.modePersona}>Other agents</p>
              <h3>Paid x402 API</h3>
              <p>
                Unpaid calls get HTTP 402 + challenge ({cfg?.x402.priceUsdc ?? "0.01"} USDC to{" "}
                {shortAddr(cfg?.x402.payTo)}). Demo bypass uses header <code>x-payment: demo</code>.
              </p>
              <div className={styles.modeActions}>
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => void run("x402-unpaid", () => runPaid({ forceBreach: true }))}
                >
                  {busy === "x402-unpaid" ? "…" : "Call unpaid (expect 402)"}
                </button>
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void run("x402-paid", () =>
                      runPaid({ forceBreach: true, payment: "demo" }),
                    )
                  }
                >
                  {busy === "x402-paid" ? "Running…" : "Pay demo + run"}
                </button>
              </div>
            </article>
          </div>
          <div className={styles.manualRow}>
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void run("manual", () => runManual(false))}
            >
              {busy === "manual" ? "Running…" : "Manual observe (often noop)"}
            </button>
            <p>
              Live RPC only — if metrics are within threshold the decision is noop and there is no
              transaction. Use Guardian breach to force an allowlisted write.
            </p>
          </div>
          {error && <p className={styles.error}>{error}</p>}
          {paymentChallenge != null && (
            <pre className={styles.challenge}>{JSON.stringify(paymentChallenge, null, 2)}</pre>
          )}
        </section>

        <section className={styles.policy} aria-labelledby="policy-heading">
          <div className={styles.sectionHead}>
            <h2 id="policy-heading">Policy gate</h2>
            <p>Hard limits before every write — kill switch stops all three modes.</p>
          </div>
          <dl className={styles.policyGrid}>
            <div>
              <dt>Kill switch</dt>
              <dd className={cfg?.killSwitch ? styles.warnText : styles.okText}>
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
              <dt>Chains</dt>
              <dd>{cfg?.chainAllowlist?.join(", ") ?? "—"}</dd>
            </div>
            <div>
              <dt>Recipients</dt>
              <dd>{cfg?.recipientAllowlist?.map(shortAddr).join(", ") ?? "—"}</dd>
            </div>
            <div>
              <dt>LLM</dt>
              <dd>{cfg?.llmEnabled ? "enabled" : "rules-only"}</dd>
            </div>
          </dl>
        </section>

        <section className={styles.actions} aria-labelledby="actions-heading">
          <div className={styles.sectionHead}>
            <h2 id="actions-heading">Allowlisted actions</h2>
            <p>
              {cfg?.preferTransferFirst
                ? "First live proof prefers tiny transfer; protocol_action is secondary; noop when healthy."
                : "Hero prefers protocol_action; transfer is the fallback; noop when healthy."}
            </p>
          </div>
          <ul className={styles.actionList}>
            {(cfg?.allowedActions ?? []).map((action) => (
              <li key={action.id}>
                <strong>{action.id}</strong>
                <span>{action.kind}</span>
                <p>{action.description}</p>
                <p className={styles.muted}>
                  {action.protocolActionType ? `${action.protocolActionType} · ` : ""}
                  max {weiToEth(action.maxAmountWei)}
                  {action.recipient ? ` · to ${shortAddr(action.recipient)}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>

        {lastResult && (
          <section className={styles.lastRun} aria-labelledby="lastrun-heading">
            <div className={styles.sectionHead}>
              <h2 id="lastrun-heading">Last cycle breakdown</h2>
              <p>
                {lastResult.trigger} · {formatDate(lastResult.at)}
              </p>
            </div>
            <div className={styles.breakdown}>
              <article>
                <h3>Observation</h3>
                <pre>{JSON.stringify(lastResult.observation ?? {}, null, 2)}</pre>
              </article>
              <article>
                <h3>Decision</h3>
                <pre>{JSON.stringify(lastResult.decision ?? {}, null, 2)}</pre>
              </article>
              <article>
                <h3>Policy</h3>
                <pre>{JSON.stringify(lastResult.policy ?? {}, null, 2)}</pre>
              </article>
              <article>
                <h3>Execution</h3>
                <pre>
                  {JSON.stringify(
                    {
                      outcome: lastResult.outcome,
                      executionId: lastResult.executionId,
                      txHash: lastResult.txHash,
                      error: lastResult.error,
                    },
                    null,
                    2,
                  )}
                </pre>
              </article>
            </div>
          </section>
        )}

        <section className={styles.audit} aria-labelledby="audit-heading">
          <div className={styles.sectionHead}>
            <h2 id="audit-heading">Execution audit</h2>
            <p>Every run: trigger → decision → policy → KeeperHub outcome</p>
          </div>
          {records.length === 0 ? (
            <p className={styles.muted}>{loading ? "Loading…" : "No runs yet."}</p>
          ) : (
            <ul className={styles.list}>
              {records.map((record) => {
                const open = expanded === record.id;
                const live = Boolean(record.txHash && !isMockTx(record.txHash));
                return (
                  <li key={record.id}>
                    <button
                      type="button"
                      className={styles.auditRow}
                      onClick={() => setExpanded(open ? null : record.id)}
                    >
                      <span>
                        <strong className={styles.outcome}>{record.outcome}</strong>
                        <span className={styles.meta}>
                          {" "}
                          · {record.trigger}
                          {record.decision?.actionId ? ` · ${record.decision.actionId}` : ""}
                          {record.decision?.rationale
                            ? ` — ${record.decision.rationale.slice(0, 72)}${record.decision.rationale.length > 72 ? "…" : ""}`
                            : ""}
                        </span>
                      </span>
                      <span className={styles.when}>{formatDate(record.at)}</span>
                      <span className={live ? styles.txLive : styles.tx}>{txLabel(record)}</span>
                    </button>
                    {open && (
                      <div className={styles.auditDetail}>
                        <pre>{JSON.stringify(record, null, 2)}</pre>
                        {live && (
                          <a
                            href={`https://sepolia.etherscan.io/tx/${record.txHash}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open on Sepolia explorer
                          </a>
                        )}
                      </div>
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
