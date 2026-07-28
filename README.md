# KeeperHub Agents Onchain

## CLI

Run one agent cycle, inspect recent status, replay audit records, or start the guardian:

```bash
KEEPERHUB_MOCK=1 npm run cli -- run
npm run cli -- status
npm run cli -- replay
npm run cli -- watch
```

## API smoke test

Start the server, run the requests from another terminal, then stop the server when finished:

```bash
KEEPERHUB_MOCK=1 X402_DEMO_BYPASS=1 npm run server
curl -s localhost:8787/api/health
curl -s localhost:8787/api/status
curl -s -X POST localhost:8787/api/run
curl -s -X POST localhost:8787/api/paid/run
curl -s -X POST localhost:8787/api/paid/run \
  -H 'x-payment: demo' \
  -H 'Content-Type: application/json'
```

The unpaid request returns HTTP 402. The request with the demo payment header runs a cycle.
