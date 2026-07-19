#!/usr/bin/env node
import { initializeManifest, resolveRuntimePaths } from "./config.js";
import { MemoryCartographer } from "./cartographer.js";
import { runMcpServer } from "./mcp.js";
import { runGuidedOnboarding } from "./onboarding.js";
import { MemoryWeaverRuntime } from "./runtime.js";
import type { StewardBriefKind } from "./types.js";

const [command = "status", ...args] = process.argv.slice(2);
const configFlag = args.indexOf("--config");
const configPath = configFlag >= 0 ? args[configFlag + 1] : undefined;
const positional = args.filter((_, index) => index !== configFlag && index !== configFlag + 1);

const print = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

const run = async (): Promise<void> => {
  const paths = resolveRuntimePaths(configPath);
  if (command === "init") {
    print({ result: await initializeManifest(paths), config: paths.config, note: "No connectors were enabled or discovered." });
    return;
  }
  if (command === "discover") {
    print(await new MemoryCartographer().discover());
    return;
  }
  if (command === "onboard") {
    const result = await runGuidedOnboarding(paths);
    print({
      connected: result.selected,
      config: paths.config,
      note: "Only approved read-only connectors were enabled. Run `memory-weaver scan`, then `memory-weaver analysis` to build the first weave and Initial Analysis.",
    });
    return;
  }
  if (command === "mcp") {
    await runMcpServer(configPath);
    return;
  }

  const runtime = await MemoryWeaverRuntime.open(configPath);
  try {
    if (command === "status") print(await runtime.status());
    else if (command === "report") print(await runtime.report());
    else if (command === "analysis") print(await runtime.initialAnalysis());
    else if (command === "shadows") print(await runtime.shadows());
    else if (command === "brief") {
      const kind = (positional[0] ?? "morning") as StewardBriefKind;
      if (!["morning", "daily", "weekly"].includes(kind)) throw new Error("Brief kind must be morning, daily, or weekly");
      print(await runtime.brief(kind));
    }
    else if (command === "latest-brief") {
      const kind = positional[0] as StewardBriefKind | undefined;
      if (kind && !["morning", "daily", "weekly"].includes(kind)) throw new Error("Brief kind must be morning, daily, or weekly");
      print(await runtime.latestBrief(kind));
    }
    else if (command === "scan") print(await runtime.scan(positional[0]));
    else if (command === "reindex") print(await runtime.reindex());
    else if (command === "weave") print(await runtime.weave());
    else if (command === "search") print(await runtime.search(positional.join(" ")));
    else if (command === "read") print(await runtime.readSource(positional[0] ?? ""));
    else if (command === "watch") {
      const count = await runtime.watch((error) => process.stderr.write(`[memory-weaver] ${error.message}\n`));
      print({ watching: count, note: "Only explicitly scoped paths are watched." });
      await new Promise<void>((resolve) => {
        process.once("SIGINT", resolve);
        process.once("SIGTERM", resolve);
      });
    } else {
      throw new Error("Usage: memory-weaver <init|discover|onboard|status|report|analysis|shadows|brief|latest-brief|scan|reindex|watch|search|read|weave|mcp> [value] [--config path]");
    }
  } finally {
    await runtime.close();
  }
};

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
