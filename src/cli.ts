import "dotenv/config";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";
import { AuditStore } from "./audit.js";
import { runAgentCycle } from "./agent/core.js";
import {
  createHttpKeeperHubClientFromEnv,
  createKeeperHubClientFromEnv,
  summarizeToolsForProbe,
} from "./keeperhub/client.js";
import { MockKeeperHubClient } from "./keeperhub/mock.js";
import { startGuardian } from "./modes/guardian.js";

export async function main(args = process.argv.slice(2)): Promise<void> {
  const [cmd = "run"] = args;
  const config = loadConfig();
  const store = new AuditStore(process.env.AUDIT_PATH ?? "data/audit.jsonl");
  const apiKeyEnv = config.keeperhubApiKeyEnv;
  const apiKey = process.env[apiKeyEnv];
  const keeperhub =
    apiKey && process.env.KEEPERHUB_MOCK !== "1"
      ? createKeeperHubClientFromEnv(apiKeyEnv)
      : new MockKeeperHubClient();

  if (cmd === "status") {
    console.log(JSON.stringify({ lastSuccessAt: store.lastSuccessAt(), recent: store.list(5) }, null, 2));
    return;
  }

  if (cmd === "replay") {
    console.log(JSON.stringify(store.list(20), null, 2));
    return;
  }

  if (cmd === "watch") {
    startGuardian({
      intervalSeconds: config.guardian.intervalSeconds,
      runCycle: () => runAgentCycle({ trigger: "guardian", config, store, keeperhub }),
      onError: (err) => console.error(err),
    });
    console.log("watching… Ctrl+C to stop");
    return;
  }

  if (cmd === "mcp-probe") {
    if (!apiKey || process.env.KEEPERHUB_MOCK === "1") {
      throw new Error(
        `mcp-probe requires a live ${apiKeyEnv} and KEEPERHUB_MOCK unset (or not 1). ` +
          "Create a kh_ key at app.keeperhub.com → Settings → API Keys.",
      );
    }
    const client = createHttpKeeperHubClientFromEnv(apiKeyEnv);
    const tools = await client.listTools();
    const summary = summarizeToolsForProbe(tools, config.chainId);
    let docs: unknown = null;
    try {
      docs = await client.toolsDocumentation();
    } catch (err) {
      docs = { error: err instanceof Error ? err.message : String(err) };
    }
    console.log(
      JSON.stringify(
        {
          mcp: process.env.KEEPERHUB_MCP_URL ?? "https://app.keeperhub.com/mcp",
          chainId: config.chainId,
          ...summary,
          toolsDocumentation: docs,
          rawTools: tools,
        },
        null,
        2,
      ),
    );
    return;
  }

  const result = await runAgentCycle({ trigger: "manual", config, store, keeperhub });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
