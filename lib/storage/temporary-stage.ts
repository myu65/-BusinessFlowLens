import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

/** Create stage-transfer files at runtime, outside the build's traced assets. */
export async function withStageDirectory<T>(work: (folder: string) => Promise<T>): Promise<T> {
  const folder = await mkdtemp(join(tmpdir(), "bfl-stage-"));
  try {
    return await work(folder);
  } finally {
    const absolute = resolve(folder);
    const name = relative(tmpdir(), absolute);
    if (!isAbsolute(name) && name.startsWith("bfl-stage-") && !name.includes("..")) {
      await rm(absolute, { recursive: true, force: true });
    }
  }
}
