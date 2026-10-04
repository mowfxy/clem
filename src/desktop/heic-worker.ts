/// <reference lib="webworker" />
// Decodes an iPhone HEIC/HEIF photo to a JPEG, away from the page. Chromium cannot show HEIC, so this uses libheif
// (LGPL-3.0, unmodified, loaded from its own libheif.wasm file) compiled to WebAssembly. See THIRD-PARTY-NOTICES.md.
import libheif from "libheif-js/libheif-wasm/libheif.js";
import wasmUrl from "libheif-js/libheif-wasm/libheif.wasm?url";

type Decoded = { decode(bytes: Uint8Array): { get_width(): number; get_height(): number; display(into: { data: Uint8ClampedArray; width: number; height: number }, done: (data: unknown) => void): void }[] };
let library: Promise<{ HeifDecoder: new () => Decoded }> | undefined;
const load = () => (library ??= (async () => {
  const wasmBinary = new Uint8Array(await (await fetch(wasmUrl)).arrayBuffer());
  return (libheif as unknown as (options: { wasmBinary: Uint8Array }) => Promise<{ HeifDecoder: new () => Decoded }>)({ wasmBinary });
})().catch((error) => { library = undefined; throw error; }));

self.onmessage = async (event: MessageEvent<{ id: number; bytes: ArrayBuffer; quality: number }>) => {
  const { id, bytes, quality } = event.data;
  const reply = (message: object) => (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, ...message });
  try {
    const images = new (await load()).HeifDecoder().decode(new Uint8Array(bytes));
    if (!images.length) throw Error("The file holds no picture.");
    const image = images[0], width = image.get_width(), height = image.get_height();
    if (!width || !height || width * height > 120_000_000) throw Error("The picture is too large to convert.");
    const data = new Uint8ClampedArray(width * height * 4);
    await new Promise<void>((done, fail) => image.display({ data, width, height }, (shown) => (shown ? done() : fail(Error("The picture could not be decoded.")))));
    const canvas = new OffscreenCanvas(width, height), context = canvas.getContext("2d")!;
    // JPEG has no transparency: any transparent pixel is flattened onto white.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    const layer = new OffscreenCanvas(width, height);
    layer.getContext("2d")!.putImageData(new ImageData(data, width, height), 0, 0);
    context.drawImage(layer, 0, 0);
    reply({ jpeg: await canvas.convertToBlob({ type: "image/jpeg", quality }), width, height });
  } catch (error) {
    reply({ error: (error as Error)?.message || "The photo could not be decoded." });
  }
};
