"use client";

import { useCallback, useEffect, useState } from "react";
import { getAudit, getStatus, runNow } from "../lib/api";
import styles from "./page.module.css";

type Status = {
  chainId?: string;
  killSwitch: boolean;
  lastSuccessAt: string | null;
  walletAddress?: string;
};

type AuditRecord = {
  id: string;
  at: string;
  trigger: string;
  outcome: string;
  txHash?: string;
  error?: string;
  decision?: {
    actionId?: string;
    rationale?: string;
  } | null;
};

function formatDate(value?: string | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

function isMockTransaction(txHash: string): boolean {
  if (/mock/i.test(txHash)) return true;
  return process.env.NEXT_PUBLIC_KEEPERHUB_MOCK === "1";
}

function shortWallet(address?: string) {
  if (!address || address.length < 12) return address ?? "—";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export default function Home() {
  const [status, setStatus] = useState<Status | null>(null);
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextStatus, audit] = await Promise.all([getStatus(), getAudit()]);
      setStatus(nextStatus);
      setRecords(audit.records ?? []);
      setError(null);
    } catch {
      setError("Unable to reach the agent API. Check that the KeeperHub service is online.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleRun() {
    setRunning(true);
    setError(null);
    try {
      await runNow();
      await refresh();
    } catch {
      setError("The agent run failed before KeeperHub returned a result.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className={styles.shell}>
      <main className={styles.page}>
        <header className={styles.brand}>
          <p className={styles.brandMark}>
            Keeper<span>Hub</span>
          </p>
          <p className={styles.brandMeta}>Agents Onchain · DoraHacks demo</p>
        </header>

        <section className={styles.hero} aria-labelledby="hero-title">
          <h1 id="hero-title">AI agents that actually finish the transaction.</h1>
          <p className={styles.lede}>
            Most agent demos stop at a clever decision. This one uses KeeperHub as the execution
            layer: observe a wallet or chain event, decide under policy, then land a real onchain
            action with an audit trail.
          </p>
          <ul className={styles.modes}>
            <li>Guardian watch</li>
            <li>Event response</li>
            <li>Paid x402 API</li>
          </ul>
        </section>

        <section className={styles.pipeline} aria-label="How the agent works">
          <article className={styles.step}>
            <span className={styles.stepIndex}>01</span>
            <strong>Observe</strong>
            <p>Read Sepolia balances, thresholds, or ingested contract events.</p>
          </article>
          <article className={styles.step}>
            <span className={styles.stepIndex}>02</span>
            <strong>Decide</strong>
            <p>Rules first, optional LLM choice, then hard policy gates.</p>
          </article>
          <article className={styles.step}>
            <span className={styles.stepIndex}>03</span>
            <strong>Execute</strong>
            <p>KeeperHub MCP runs the write path and returns a tx hash.</p>
          </article>
        </section>

        <section className={styles.console} aria-labelledby="console-heading">
          <div className={styles.consoleHeader}>
            <div>
              <h2 id="console-heading">Live agent console</h2>
              <p className={styles.consoleHint}>
                Trigger a full cycle now. Mock mode shows labeled fake hashes until a live{" "}
                <code>kh_</code> key is configured.
              </p>
            </div>
            <button className={styles.run} type="button" onClick={handleRun} disabled={running || loading}>
              {running ? "Executing…" : "Run agent"}
            </button>
          </div>

          <dl className={styles.metrics}>
            <div>
              <dt>Agent</dt>
              <dd
                className={
                  status?.killSwitch ? styles.warn : loading ? undefined : styles.ready
                }
              >
                {!status?.killSwitch && !loading && <span className={styles.readyDot} aria-hidden />}
                {loading ? "Connecting…" : status?.killSwitch ? "Kill switch on" : "Ready"}
              </dd>
            </div>
            <div>
              <dt>Network</dt>
              <dd>{status?.chainId ?? "—"}</dd>
            </div>
            <div>
              <dt>Wallet</dt>
              <dd title={status?.walletAddress}>{shortWallet(status?.walletAddress)}</dd>
            </div>
            <div>
              <dt>Last success</dt>
              <dd>{formatDate(status?.lastSuccessAt)}</dd>
            </div>
          </dl>

          {error && <p className={styles.error}>{error}</p>}
        </section>

        <section className={styles.audit} aria-labelledby="audit-heading">
          <div className={styles.auditHeader}>
            <h2 id="audit-heading">Execution audit</h2>
            <p>Every run: trigger → decision → policy → KeeperHub outcome</p>
          </div>

          {records.length === 0 ? (
            <p className={styles.muted}>{loading ? "Loading audit…" : "No runs yet. Hit Run agent."}</p>
          ) : (
            <ul className={styles.list}>
              {records.map((record) => (
                <li key={record.id}>
                  <div>
                    <p className={styles.outcome}>{record.outcome}</p>
                    <p className={styles.meta}>
                      {record.trigger}
                      {record.decision?.actionId ? ` · ${record.decision.actionId}` : ""}
                      {record.decision?.rationale ? ` — ${record.decision.rationale}` : ""}
                    </p>
                  </div>
                  <span className={styles.when}>{formatDate(record.at)}</span>
                  {record.txHash ? (
                    isMockTransaction(record.txHash) ? (
                      <span className={styles.tx} title="Local mock execution only">
                        mock tx (not on explorer)
                      </span>
                    ) : (
                      <a
                        className={styles.tx}
                        href={`https://sepolia.etherscan.io/tx/${record.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View on Sepolia
                      </a>
                    )
                  ) : (
                    <span className={styles.tx}>{record.error ?? "No transaction"}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
