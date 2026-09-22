import { Worker } from "node:worker_threads";
import { join } from "node:path";
import reference from "./generated/kinetra.json" with { type: "json" };
export const kinetraInstructions = `Built-in Kinetra tools are available to every model. Use them when relevant for verified calculations, technical learning, and figures INSIDE requested documents; never substitute a preset gallery. Skills: ${Object.keys(reference.skills).join(", ")}. To call a tool respond ONLY with a JSON object {"kinetra":{"action":"skill","name":"kinetra-diagrams"}}. Actions: skill(name) reads the FULL skill; api(module) reads its actual TypeScript API; call(module,fn,args[]) executes a pure function; pdf(title,sections[]) creates a real local PDF. Each PDF section is {heading?:string,text?:string,figure?:{module:string,fn:string,args:[]},caption?:string}. Figures are computed by Kinetra, not model-authored SVG. A call to a renderer validates a figure but does not save a file; only a successful pdf action creates an attachment. The api action can read supporting type modules such as graph/spec in addition to executable modules. Modules: ${reference.modules.join(", ")}. Read the relevant skill and API before using it. Prefer module mowr for JSON-friendly fields, numerical integration, retrieval and study schedules. Other APIs requiring functions, Map instances or classes cannot be called directly. JSON arguments only, no executable functions or code. Limits: 12 tool calls per response; calculations time out after 5 seconds. Source files in guides describe upstream capabilities; only these module APIs are callable here. Do not claim unavailable operations ran. Final response must answer the user in the originally requested format, without tool JSON. Never create a PDF unless the user requested a document. A tool error is not success. Use supported models and explicitly state assumptions.`;
export async function kinetraCall(request: any) {
  if (JSON.stringify(request).length > 100000)
    throw Error("Kinetra input too large");
  return new Promise<any>((resolve, reject) => {
    const worker = new Worker(
      join(
        typeof __dirname === "string"
          ? __dirname
          : process.cwd() + "/desktop-dist",
        "kinetra-worker.cjs",
      ),
      { workerData: request, resourceLimits: { maxOldGenerationSizeMb: 96 } },
    );
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(Error("Kinetra calculation timed out"));
    }, 5000);
    worker.once("message", (message) => {
      clearTimeout(timer);
      void worker.terminate();
      message.error ? reject(Error(message.error)) : resolve(message.result);
    });
    worker.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    worker.once("exit", () => {
      clearTimeout(timer);
      reject(Error("Kinetra worker stopped without a result"));
    });
  });
}
export async function kinetraTool(
  request: any,
  pdf?: (spec: any) => Promise<any>,
) {
  if (!request || typeof request !== "object")
    throw Error("Invalid Kinetra request");
  if (
    request.action === "skill" &&
    Object.hasOwn(reference.skills, request.name)
  )
    return (reference.skills as Record<string, string>)[request.name];
  if (request.action === "api" && Object.hasOwn(reference.api, request.module))
    return (reference.api as Record<string, string>)[request.module];
  if (request.action === "call") return kinetraCall(request);
  if (request.action === "pdf" && pdf) return pdf(request);
  throw Error("Unsupported Kinetra operation");
}
