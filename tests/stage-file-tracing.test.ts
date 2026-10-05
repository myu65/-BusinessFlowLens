import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const { nodeFileTrace } = createRequire(import.meta.url)("next/dist/compiled/@vercel/nft") as {
  nodeFileTrace(files: string[], options: { base: string; processCwd: string; ignore: (path: string) => boolean }): Promise<unknown>;
};

test("stage download tracing never walks the operating system's temporary files", async () => {
  const base = resolve(process.cwd(), ".data");
  await mkdir(base, { recursive: true });
  const folder = await mkdtemp(join(base, "bfl-stage-trace-test-"));
  try {
    // Trace the runtime file operations without loading application dependencies.
    for (const name of ["snowflake", "temporary-stage"]) {
      const source = await readFile(join(process.cwd(), "lib/storage", `${name}.ts`), "utf8");
      const output = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText;
      await writeFile(join(folder, `${name}.js`), output);
    }
    const outsideGlobs: string[] = [];
    await nodeFileTrace([join(folder, "snowflake.js")], {
      base: folder,
      processCwd: folder,
      ignore: path => {
        const absolute = resolve(folder, path);
        const outside = absolute !== folder && !absolute.startsWith(folder + sep);
        if (outside && path.includes("*")) outsideGlobs.push(path);
        return outside;
      },
    });
    assert.deepEqual(outsideGlobs, [], "runtime stage files must not cause a build to inspect other applications' temporary files");
  } finally {
    const absolute = resolve(folder);
    if (absolute.startsWith(base + sep) && absolute.slice(base.length + 1).startsWith("bfl-stage-trace-test-")) {
      await rm(absolute, { recursive: true, force: true });
    }
  }
});
