const tag = "CLEM-PROVENANCE-v1:";
const encoder = new TextEncoder(),
  decoder = new TextDecoder();
async function digest(bytes: Uint8Array) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as BufferSource),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
function zipEnd(bytes: Uint8Array) {
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (
      bytes[i] === 80 &&
      bytes[i + 1] === 75 &&
      bytes[i + 2] === 5 &&
      bytes[i + 3] === 6 &&
      i + 22 + (bytes[i + 20] | (bytes[i + 21] << 8)) === bytes.length
    )
      return i;
  return -1;
}
export async function markContent(blob: Blob, name: string): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer()),
    end = zipEnd(bytes),
    hash = await digest(bytes);
  const receipt = JSON.stringify({
    app: "Clem",
    version: 1,
    sha256: hash,
    createdAt: new Date().toISOString(),
    originalLength: bytes.length,
    zipEnd: end,
  });
  let marker: Uint8Array<ArrayBuffer>;
  if (end >= 0) {
    marker = encoder.encode(tag + receipt);
    const copy = bytes.slice(),
      length = (bytes[end + 20] | (bytes[end + 21] << 8)) + marker.length;
    if (length > 65535) throw Error("Archive metadata is too large.");
    copy[end + 20] = length & 255;
    copy[end + 21] = length >> 8;
    return new Blob([copy, marker], { type: blob.type });
  }
  const metadata = tag + receipt;
  if (/\.pdf$/i.test(name)) marker = encoder.encode("\n%" + metadata + "\n");
  else if (/\.(svg|html|md)$/i.test(name))
    marker = encoder.encode("\n<!--" + metadata + "-->");
  else if (/\.tex$/i.test(name))
    marker = encoder.encode("\n%" + metadata + "\n");
  else {
    const bits = Array.from(encoder.encode(metadata))
      .map((b) => b.toString(2).padStart(8, "0"))
      .join("");
    marker = encoder.encode(
      "\u2063" +
        bits.replace(/0/g, "\u200b").replace(/1/g, "\u200c") +
        "\u2063",
    );
  }
  return new Blob([bytes, marker], { type: blob.type });
}
export async function checkContent(
  blob: Blob,
): Promise<{ status: "found" | "changed" | "missing"; createdAt?: string }> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let tail = decoder.decode(bytes.slice(-16000));
  const invisible = tail.match(/\u2063([\u200b\u200c]+)\u2063$/);
  if (invisible) {
    const bits = invisible[1].replace(/\u200b/g, "0").replace(/\u200c/g, "1");
    tail = decoder.decode(
      Uint8Array.from(bits.match(/.{8}/g) || [], (b) => parseInt(b, 2)),
    );
  }
  const index = tail.lastIndexOf(tag);
  if (index < 0) return { status: "missing" };
  try {
    const raw = tail.slice(index + tag.length).match(/^\{[^\n]*?\}/)?.[0];
    if (!raw) return { status: "changed" };
    const info = JSON.parse(raw);
    if (
      info.app !== "Clem" ||
      info.version !== 1 ||
      !Number.isInteger(info.originalLength) ||
      info.originalLength < 0 ||
      info.originalLength >= bytes.length
    )
      return { status: "changed" };
    if (
      !Number.isInteger(info.zipEnd) ||
      info.zipEnd < -1 ||
      typeof info.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(info.sha256)
    )
      return { status: "changed" };
    const suffix = decoder.decode(bytes.slice(info.originalLength));
    const metadata = tag + raw;
    const bits = Array.from(encoder.encode(metadata))
      .map((b) => b.toString(2).padStart(8, "0"))
      .join("");
    const invisibleMarker =
      "\u2063" +
      bits.replace(/0/g, "\u200b").replace(/1/g, "\u200c") +
      "\u2063";
    if (
      ![
        metadata,
        "\n%" + metadata + "\n",
        "\n<!--" + metadata + "-->",
        invisibleMarker,
      ].includes(suffix)
    )
      return { status: "changed" };
    const original = bytes.slice(0, info.originalLength);
    if (info.zipEnd >= 0) {
      if (info.zipEnd + 22 > original.length) return { status: "changed" };
      const count = original.length - info.zipEnd - 22;
      original[info.zipEnd + 20] = count & 255;
      original[info.zipEnd + 21] = count >> 8;
    }
    return {
      status: (await digest(original)) === info.sha256 ? "found" : "changed",
      createdAt: info.createdAt,
    };
  } catch {
    return { status: "changed" };
  }
}
