import { safeStorage } from "electron";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";

/** Secrets never cross IPC. DPAPI is required; no plaintext fallback. */
export class Vault {
  private queue = Promise.resolve();
  constructor(private directory: string) {}
  async read<T>(key: string, fallback: T): Promise<T> {
    if (!safeStorage.isEncryptionAvailable())
      throw Error("Windows credential protection is unavailable.");
    try {
      return JSON.parse(
        safeStorage.decryptString(
          await readFile(join(this.directory, key + ".bin")),
        ),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
      throw Error("Protected local data could not be opened.");
    }
  }
  write(key: string, value: unknown) {
    const operation = this.queue.then(async () => {
      if (!safeStorage.isEncryptionAvailable())
        throw Error("Windows credential protection is unavailable.");
      await mkdir(this.directory, { recursive: true });
      const path = join(this.directory, key + ".bin");
      await writeFile(
        path + ".tmp",
        safeStorage.encryptString(JSON.stringify(value)),
      );
      await rename(path + ".tmp", path);
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}
