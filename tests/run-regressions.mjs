import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const port = process.env.REGRESSION_PORT ?? "3105";
const sqlitePath =
  process.env.BUSINESS_FLOW_SQLITE_PATH ??
  path.join(".data", "workflow-regressions.sqlite");
const logPath = path.join(".data", "regression-server.log");

await fs.mkdir(".data", { recursive: true });
for (const suffix of ["", "-shm", "-wal"]) {
  await fs.rm(`${sqlitePath}${suffix}`, { force: true });
}

const env = {
  ...process.env,
  AI_MODEL: "",
  BUSINESS_FLOW_STORAGE: "sqlite",
  BUSINESS_FLOW_SQLITE_PATH: sqlitePath,
  BUSINESS_FLOW_LOCAL_USER:
    process.env.BUSINESS_FLOW_LOCAL_USER ?? "ci-user",
  NEXT_TELEMETRY_DISABLED: "1",
};

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const server = spawn(
  npmCommand,
  ["run", "start", "--", "-p", port],
  {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let serverLog = "";
const capture = (chunk) => {
  const text = chunk.toString();
  serverLog += text;
  process.stdout.write(text);
};

server.stdout.on("data", capture);
server.stderr.on("data", capture);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer() {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(
        `Next.js server exited before becoming ready (code ${server.exitCode}).`,
      );
    }

    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok || response.status < 500) return;
    } catch {
      // Server is still starting.
    }

    await sleep(500);
  }

  throw new Error("Timed out waiting for regression server.");
}

function runRegressionSuite() {
  return new Promise((resolve, reject) => {
    const test = spawn(
      process.execPath,
      ["tests/workflow-regressions.mjs"],
      {
        env: {
          ...env,
          REGRESSION_PORT: port,
        },
        stdio: "inherit",
      },
    );

    test.on("error", reject);
    test.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            `Regression suite failed (code=${code}, signal=${signal}).`,
          ),
        );
      }
    });
  });
}

let failure;
try {
  await waitForServer();
  await runRegressionSuite();
} catch (error) {
  failure = error;
} finally {
  await fs.writeFile(logPath, serverLog, "utf8");

  if (server.exitCode === null) {
    server.kill("SIGTERM");

    const deadline = Date.now() + 3_000;
    while (server.exitCode === null && Date.now() < deadline) {
      await sleep(100);
    }

    if (server.exitCode === null) {
      server.kill("SIGKILL");
    }
  }
}

if (failure) {
  console.error(failure);
  process.exitCode = 1;
}
