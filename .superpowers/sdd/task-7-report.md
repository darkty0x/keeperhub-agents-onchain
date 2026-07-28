# Task 7 Report: Agent core pipeline

## Status

DONE

## Requirements coverage

| Step | Item | Done |
|------|------|------|
| 1 | `tests/agent-core.test.ts` — kill switch blocks and audits | Yes |
| 2 | `tests/agent-core.test.ts` — breach executes and records tx hash | Yes |
| 3 | `src/observe.ts` — read-only native balance observation | Yes |
| 4 | `src/agent/core.ts` — observe, decide, policy, execute, audit pipeline | Yes |
| 5 | Git commit | Yes |

## TDD evidence

**RED** — before implementation:

```text
Error: Cannot find module '../src/agent/core.js'
```

**GREEN** — after implementation:

```text
Test Files  1 passed (1)
Tests  2 passed (2)
```

Full suite:

```text
Test Files  7 passed (7)
Tests  20 passed (20)
```

## Files changed / created

| Path | Action |
|------|--------|
| `src/observe.ts` | Created native balance observation via JSON-RPC |
| `src/agent/core.ts` | Created end-to-end agent cycle |
| `tests/agent-core.test.ts` | Created kill-switch and execution tests |

## Implementation notes

- Injected observations are supported; otherwise `observe()` queries `eth_getBalance`.
- Unknown actions are audited as failed.
- Policy blocks are audited as blocked, and noop decisions are audited as noop.
- Successful and failed KeeperHub statuses are audited with execution metadata.
- KeeperHub exceptions are caught and recorded as failed audits.

## Verification

| Command | Result |
|---------|--------|
| `npm test -- tests/agent-core.test.ts` | PASS (2 tests) |
| `npm test` | PASS (20 tests across 7 files) |
| `npm run build` | FAIL (pre-existing TypeScript configuration/dependency errors; see concerns) |

## Concerns

1. `npm run build` remains blocked by the repository's existing `tsconfig.json` `"types": []` and related errors in `audit.ts`, `config.ts`, and `decision.ts`; the new core file also surfaces the same missing Node type declarations.
2. `observe()` intentionally falls back to zero balance on RPC/network/response errors, matching the brief's demo-safe behavior.

## Commit

```text
feat: add observe and agent execution pipeline
```

Hash: see `git log` for the final commit hash on branch `feature/keeperhub-agents-onchain`.

Files: `src/observe.ts`, `src/agent/core.ts`, `tests/agent-core.test.ts`, `.superpowers/sdd/task-7-report.md`.
