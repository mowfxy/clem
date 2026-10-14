/** The files in a paste: copied files keep their names; a screenshot or a copied picture (which the clipboard calls
 *  "image.png") gets a name that says when it was pasted, so several pasted pictures are told apart. */
export function pastedFiles(data: DataTransfer, now = new Date()): File[] {
  const files = Array.from(data.files).filter((file) => file.size > 0 || file.type);
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`;
  let pictures = 0;
  return files.map((file) => {
    if (!/^image\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name) && file.name) return file;
    const ext = (file.name.split(".").pop() || file.type.split("/")[1] || "png").toLowerCase();
    pictures++;
    return new File([file], `Pasted image ${stamp}${pictures > 1 ? ` (${pictures})` : ""}.${ext}`, { type: file.type || "image/png", lastModified: now.getTime() });
  });
}
const pad = (n: number) => String(n).padStart(2, "0");

/** Whether a paste happened where Mowr should take files: the chat box, or the page itself, not another field. */
export function pasteTarget(target: EventTarget | null) {
  const el = target instanceof HTMLElement ? target : null;
  if (!el) return true;
  if (el.closest(".composer")) return true;
  return !(el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.closest("[role=dialog], .modal"));
}
