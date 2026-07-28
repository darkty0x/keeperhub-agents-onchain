"use client";

import { useCallback, useEffect, useState } from "react";
import { getAudit, getStatus, runNow } from "../lib/api";
import styles from "./page.module.css";

type Status = {
  chainId?: string;
  killSwitch: boolean;
  lastSuccessAt: string | null;
};

type AuditRecord = {
  id: string;
  at: string;
  trigger: string;
  outcome: string;
  txHash?: string;
  error?: string;
};

function formatDate(value?: string | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
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
      setError("Unable to connect to the KeeperHub API.");
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
      setError("The run could not be completed.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className={styles.page}>
      <header>
        <p className={styles.eyebrow}>KeeperHub demo</p>
        <h1>Agent dashboard</h1>
      </header>

      <section className={styles.status} aria-labelledby="status-heading">
        <div>
          <h2 id="status-heading">Status</h2>
          <p className={status?.killSwitch ? styles.warning : styles.ok}>
            {loading ? "Loading…" : status?.killSwitch ? "Kill switch enabled" : "Ready"}
          </p>
        </div>
        <dl>
          <div>
            <dt>Chain</dt>
            <dd>{status?.chainId ?? "—"}</dd>
          </div>
          <div>
            <dt>Last success</dt>
            <dd>{formatDate(status?.lastSuccessAt)}</dd>
          </div>
        </dl>
        <button type="button" onClick={handleRun} disabled={running || loading}>
          {running ? "Running…" : "Run now"}
        </button>
      </section>

      {error && <p className={styles.error}>{error}</p>}

      <section aria-labelledby="audit-heading">
        <h2 id="audit-heading">Recent audit</h2>
        {records.length === 0 ? (
          <p className={styles.muted}>{loading ? "Loading…" : "No runs yet."}</p>
        ) : (
          <ul className={styles.audit}>
            {records.map((record) => (
              <li key={record.id}>
                <span>
                  <strong>{record.outcome}</strong> · {record.trigger}
                </span>
                <span>{formatDate(record.at)}</span>
                {record.txHash ? (
                  <a
                    href={`https://sepolia.etherscan.io/tx/${record.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View transaction
                  </a>
                ) : (
                  <span className={styles.muted}>{record.error ?? "No transaction"}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
