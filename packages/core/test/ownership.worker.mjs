import { parentPort, workerData } from "node:worker_threads";
import { classifyOwnership } from "../src/ownership.ts";

if (!parentPort) {
  throw new Error("ownership.worker.mjs must run inside a Worker.");
}

const results = workerData.map(({ title, expectedPrefix, format }) => {
  const heading = {
    level: 2,
    line: 0,
    indent: "",
    marker: "##",
    rawText: title,
    semanticText: title,
    sourceRange: { from: 0, to: title.length + 3 },
    contentRange: { from: 3, to: title.length + 3 },
    closingSequence: "",
    lineEnding: "\n",
  };
  return classifyOwnership(heading, expectedPrefix, format);
});

parentPort.postMessage(results);
