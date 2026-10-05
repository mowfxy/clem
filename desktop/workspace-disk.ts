import { mkdir, readFile, writeFile, rename, unlink, stat } from "node:fs/promises";
import { join } from "node:path";
export class WorkspaceDisk {
  private root: string;
  constructor(root: string) {
    this.root = root;
  }
  private folder(owner: string) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(owner)) throw Error("Invalid account");
    return join(this.root, "Accounts", owner);
  }
  private file(owner: string, id: string) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw Error("Invalid file");
    return join(this.folder(owner), "Files", id + ".blob");
  }
  async readState(owner: string) {
    try {
      return JSON.parse(
        await readFile(join(this.folder(owner), "workspace.json"), "utf8"),
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }
  async writeState(owner: string, value: unknown) {
    const dir = this.folder(owner);
    await mkdir(dir, { recursive: true });
    const target = join(dir, "workspace.json"),
      tmp = target + "." + crypto.randomUUID() + ".tmp";
    await writeFile(tmp, JSON.stringify(value));
    await rename(tmp, target);
  }
  async readFile(owner: string, id: string) {
    try {
      return await readFile(this.file(owner, id));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }
  /** Whether a file is there, without reading it. */
  async hasFile(owner: string, id: string) {
    return stat(this.file(owner, id)).then((info) => info.isFile(), () => false);
  }
  async writeFile(owner: string, id: string, data: Uint8Array) {
    const target = this.file(owner, id);
    await mkdir(join(this.folder(owner), "Files"), { recursive: true });
    const tmp = target + "." + crypto.randomUUID() + ".tmp";
    await writeFile(tmp, data);
    await rename(tmp, target);
  }
  async deleteFile(owner: string, id: string) {
    await unlink(this.file(owner, id)).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
  }
}
