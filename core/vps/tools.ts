// The AI's VPS actions on the kinetra tool, only while a VPS is connected (docs/GUC-VPS-ENGINE.md "AI tools").
// Byte-stable guide, so prompt caching keeps it.
export const VPS_ACTIONS = ["vps.run_command", "vps.read_file", "vps.write_file", "vps.service_status"] as const;
export const isVpsAction = (a: unknown): a is (typeof VPS_ACTIONS)[number] => typeof a === "string" && (VPS_ACTIONS as readonly string[]).includes(a);
export const VPS_GUIDE = `VPS: the person connected their own server. Use it only when they ask about it.
- {"kinetra":{"action":"vps.service_status"}}: Clem's worker, Docker or systemd, disk and memory.
- {"kinetra":{"action":"vps.run_command","command":"…"}}: read-only commands run at once (output capped). Anything that could change the server (installing a package, restarting a service, freeing disk space) is asked first: in the app it returns a vps_confirm card (put it in your reply and wait, the person taps Run it); on Telegram from the VPS, Clem asks in words with the exact command and runs it when the person says yes. Ask for what the request needs; never refuse it as impossible.
- {"kinetra":{"action":"vps.read_file","path":"…"}}: a text file (paths relative to their home folder unless absolute).
- {"kinetra":{"action":"vps.write_file","path":"…","content":"…"}}: writes a new file; replacing an existing one returns a vps_confirm card the same way.`;
