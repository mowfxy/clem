/**
 * Kinetra CLI entry point.
 *
 * Minimal command dispatcher for Kinetra's local-first workflows. Each
 * command delegates to a workflow module so the CLI stays a thin shell.
 */
import { runDemo } from "../workflows/demo.js";
import { runWorkflowA } from "../workflows/workflow-a.js";
import { runWorkflowB } from "../workflows/workflow-b.js";
import { runWorkflowC } from "../workflows/workflow-c.js";
import { runWorkflowD } from "../workflows/workflow-d.js";
import { runBenchmarkCli } from "../workflows/benchmark.js";
import { runDiagram } from "../workflows/diagram.js";

const USAGE = `kinetra <command>

Commands:
  demo                quick demo of every engine
  workflow-a          Karnaugh map end-to-end
  workflow-b          physics + 2D diagram
  workflow-c          circuit analysis + schematic
  workflow-d          retrieval + learning
  benchmark           retrieval benchmark
  diagram             charged-rod illustration from optional JSON model
`;

async function main(argv: string[]): Promise<void> {
  const cmd = argv[2];
  switch (cmd) {
    case "demo": return runDemo();
    case "workflow-a": return runWorkflowA();
    case "workflow-b": return runWorkflowB();
    case "workflow-c": return runWorkflowC();
    case "workflow-d": return runWorkflowD();
    case "benchmark": return runBenchmarkCli();
    case "diagram": return runDiagram(argv[3], argv[4]);
    case undefined:
    case "--help":
    case "-h":
      console.log(USAGE);
      return;
    default:
      console.error(`Unknown command: ${cmd}\n${USAGE}`);
      process.exit(2);
  }
}

main(process.argv).catch((e) => {
  console.error("kinetra: fatal:", e);
  process.exit(1);
});
