export function youtubeReference(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port)
      return null;
    const host = url.hostname;
    let id = "";
    if (host === "youtu.be") id = url.pathname.slice(1);
    else if (
      ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(host)
    ) {
      if (url.pathname === "/watch") id = url.searchParams.get("v") || "";
      else
        id =
          url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)\/?$/)?.[1] ||
          "";
    }
    if (!/^[\w-]{11}$/.test(id)) return null;
    const time =
      url.searchParams.get("t") || url.searchParams.get("start") || "";
    const parts = time.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
    const start = Math.min(
      86400,
      /^\d+$/.test(time)
        ? Number(time)
        : parts
          ? Number(parts[1] || 0) * 3600 +
            Number(parts[2] || 0) * 60 +
            Number(parts[3] || 0)
          : 0,
    );
    return {
      id,
      start,
      url: `https://www.youtube.com/watch?v=${id}${start ? "&t=" + start : ""}`,
    };
  } catch {
    return null;
  }
}
export function youtubeReferences(text: string) {
  const found = new Map<
    string,
    NonNullable<ReturnType<typeof youtubeReference>>
  >();
  for (const match of text.matchAll(/https:\/\/[^\s<>"\]]+/g)) {
    const ref = youtubeReference(match[0].replace(/[).,;!?]+$/, ""));
    if (ref && !found.has(ref.id)) found.set(ref.id, ref);
    if (found.size === 3) break;
  }
  return [...found.values()];
}
/** A YouTube playlist address ("…/playlist?list=…", or a video watched inside one), or null. */
export function youtubePlaylistReference(value: string) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || !["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"].includes(url.hostname)) return null;
    const id = url.searchParams.get("list") || "";
    return /^[\w-]{10,64}$/.test(id) ? { id, url: `https://www.youtube.com/playlist?list=${id}` } : null;
  } catch {
    return null;
  }
}
