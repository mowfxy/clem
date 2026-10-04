// iPhone photos arrive as HEIC/HEIF, which Chromium cannot decode. They are converted to JPEG when attached, so the AI
// sees them and the chat shows a thumbnail (src/desktop/heic-worker.ts does the decoding in WebAssembly).

/** Whether these bytes start like a HEIC/HEIF/HEIX image: an ISO "ftyp" box naming a HEIF brand. */
export function heicBytes(head: Uint8Array) {
  if (head.length < 12 || String.fromCharCode(...head.subarray(4, 8)) !== "ftyp") return false;
  return /hei[cxmsv]|hev[cx]|mif1|msf1/.test(String.fromCharCode(...head.subarray(8, Math.min(head.length, 72))));
}
/** A HEIC/HEIF photo by name or type. A file with neither (shared without an extension) is caught by `looksHeic`. */
export const isHeic = (file: { name: string; type?: string }) => /\.(heic|heif|hif)$/i.test(file.name) || /^image\/hei[cf]/i.test(file.type || "");
/** `isHeic`, or an image/unknown file whose first bytes say HEIC. */
export async function looksHeic(file: Blob & { name?: string }) {
  if (isHeic({ name: file.name || "", type: file.type })) return true;
  if (file.type && !/^(application\/octet-stream|image\/)/.test(file.type)) return false;
  return heicBytes(new Uint8Array(await file.slice(0, 80).arrayBuffer()));
}

let worker: Worker | undefined, next = 1;
/** Converts a HEIC/HEIF photo to a JPEG. Rejects with a message the person can read when the file cannot be decoded. */
export function heicToJpeg(file: Blob, quality = 0.92): Promise<{ jpeg: Blob; width: number; height: number }> {
  if (file.size > 80_000_000) return Promise.reject(Error("The photo is over 80 MB, too large to convert."));
  const id = next++;
  const w = (worker ??= new Worker(new URL("./heic-worker.ts", import.meta.url), { type: "module", name: "mowr-heic" }));
  return new Promise((resolve, reject) => {
    const finish = (done: () => void) => { clearTimeout(timer); w.removeEventListener("message", listen); w.removeEventListener("error", crash); done(); };
    const listen = (event: MessageEvent<{ id: number; jpeg?: Blob; width?: number; height?: number; error?: string }>) => {
      if (event.data.id !== id) return;
      finish(() => (event.data.jpeg ? resolve({ jpeg: event.data.jpeg, width: event.data.width!, height: event.data.height! }) : reject(Error(event.data.error || "The photo could not be decoded."))));
    };
    // A crashed or stuck worker is thrown away so the next photo starts a fresh one.
    const stop = (message: string) => finish(() => { w.terminate(); if (worker === w) worker = undefined; reject(Error(message)); });
    const crash = () => stop("The photo converter stopped unexpectedly.");
    const timer = setTimeout(() => stop("Converting the photo took too long."), 90_000);
    w.addEventListener("message", listen);
    w.addEventListener("error", crash);
    file.arrayBuffer().then((bytes) => w.postMessage({ id, bytes, quality }, [bytes]), (error) => finish(() => reject(error)));
  });
}
/** The JPEG file that replaces a HEIC photo (same name, .jpg), or an error that names the photo. */
export async function convertedPhoto(file: File): Promise<File> {
  try {
    const { jpeg } = await heicToJpeg(file);
    return new File([jpeg], file.name.replace(/\.(heic|heif|hif)$/i, "") + ".jpg", { type: "image/jpeg", lastModified: file.lastModified });
  } catch (error) {
    throw Error(`“${file.name}” is a HEIC photo and could not be converted to JPEG (${(error as Error).message.replace(/[.\s]+$/, "")}). Export it as JPEG from Photos and attach that instead.`);
  }
}
