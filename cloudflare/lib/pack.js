// Compact storage for D1: JSON text is deflated and kept as a BLOB. Values stored before packing
// (plain text) still read back unchanged, so no migration of existing rows is needed.

const MAGIC = 0x6d; // "m": marks a packed value

async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** Text → [MAGIC, ...deflate-raw(text)] */
export async function pack(text) {
  const deflated = await pipe(new TextEncoder().encode(text), new CompressionStream("deflate-raw"));
  const out = new Uint8Array(deflated.length + 1);
  out[0] = MAGIC;
  out.set(deflated, 1);
  return out;
}

/** Reads a packed BLOB, or returns legacy plain text as it is. */
export async function unpack(value) {
  if (value == null) return value;
  if (typeof value === "string") return value;
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  if (bytes[0] !== MAGIC) return new TextDecoder().decode(bytes);
  return new TextDecoder().decode(await pipe(bytes.subarray(1), new DecompressionStream("deflate-raw")));
}
