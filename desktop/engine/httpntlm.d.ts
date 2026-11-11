declare module "httpntlm" {
  import type { Agent } from "node:https";
  type Options = { url: string; username: string; password: string; domain?: string; workstation?: string; agent?: Agent; headers?: Record<string, string>; parameters?: Record<string, string>; timeout?: number; binary?: boolean };
  type Response = { statusCode: number; headers: Record<string, string | undefined>; body: string };
  type Callback = (error: (Error & { code?: string }) | null, response: Response) => void;
  const httpntlm: { get(options: Options, callback: Callback): void; post(options: Options, callback: Callback): void; method(method: string, options: Options, callback: Callback): void };
  export default httpntlm;
}
