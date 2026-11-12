// The AI's VPS actions on the kinetra tool, only while a VPS is connected (docs/GUC-VPS-ENGINE.md "AI tools").
// Byte-stable guide, so prompt caching keeps it.
export const VPS_ACTIONS = ["vps.run_command", "vps.read_file", "vps.write_file", "vps.service_status"] as const;
export const isVpsAction = (a: unknown): a is (typeof VPS_ACTIONS)[number] => typeof a === "string" && (VPS_ACTIONS as readonly string[]).includes(a);
export const VPS_GUIDE = `VPS: the person connected their own server. Use it only when they ask about it.
- {"kinetra":{"action":"vps.service_status"}}: Clem's worker, Docker or systemd, disk and memory.
- {"kinetra":{"action":"vps.run_command","command":"…"}}: read-only commands run at once (output capped); anything that could change the server returns a vps_confirm card instead: put it in your reply and wait, the person taps Run it.
- {"kinetra":{"action":"vps.read_file","path":"…"}}: a text file (paths relative to their home folder unless absolute).
- {"kinetra":{"action":"vps.write_file","path":"…","content":"…"}}: writes a new file; replacing an existing one returns a vps_confirm card the same way.`;
