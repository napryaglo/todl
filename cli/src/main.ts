import { list } from "./commands/list.js";
import { run } from "./commands/run.js";
import { test } from "./commands/test.js";
import { docs } from "./commands/docs.js";

export function runCommand(argv: string[]): number {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "list": return list();
    case "run": return run(rest[0]);
    case "test": return test(rest.includes("--update"));
    case "docs": return docs(rest);
    default:
      process.stdout.write("usage: todl-demo <list|run <id>|test [--update]|docs [--out <dir>]>\n");
      return cmd === undefined ? 1 : 1;
  }
}

// Direct invocation entry point.
if (process.argv[1] && /main\.(ts|js|mts|mjs)$/.test(process.argv[1])) {
  process.exit(runCommand(process.argv.slice(2)));
}
