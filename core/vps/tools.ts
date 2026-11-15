// The AI's VPS actions on the kinetra tool, only while a VPS is connected (docs/GUC-VPS-ENGINE.md "AI tools").
// Byte-stable guide, so prompt caching keeps it.
export const VPS_ACTIONS = ["vps.run_command", "vps.read_file", "vps.write_file", "vps.service_status", "vps.waiting", "vps.keep", "vps.copies"] as const;
export const isVpsAction = (a: unknown): a is (typeof VPS_ACTIONS)[number] => typeof a === "string" && (VPS_ACTIONS as readonly string[]).includes(a);
export const VPS_GUIDE = `VPS: the person connected their own server. Use it only when they ask about it.
- {"kinetra":{"action":"vps.service_status"}}: Clem's worker, Docker or systemd, disk and memory.
- {"kinetra":{"action":"vps.run_command","command":"…"}}: read-only commands run at once (output capped). Anything that could change the server (installing a package, restarting a service, freeing disk space) is asked first: in the app it returns a vps_confirm card (put it in your reply and wait, the person taps Run it); on Telegram from the VPS, Clem asks in words with the exact command and runs it when the person says yes. Ask for what the request needs; never refuse it as impossible.
- {"kinetra":{"action":"vps.read_file","path":"…"}}: a text file (paths relative to their home folder unless absolute).
- {"kinetra":{"action":"vps.write_file","path":"…","content":"…"}}: writes a new file; replacing an existing one returns a vps_confirm card the same way.
- {"kinetra":{"action":"vps.waiting"}}: what wasn't copied to the VPS because it's at Clem's limit (82% of its disk). Information only: the PC keeps every file, so nothing waits to come back.
- {"kinetra":{"action":"vps.copies","on":true|false}}: "Keep a copy of my files on the VPS". On (the default) copies every file there too, under the limit; off keeps files on the PC only and removes the VPS copies once the PC is confirmed to hold each one. The PC always keeps everything either way.
- {"kinetra":{"action":"vps.keep","file":"<file name or id>","where":"pc"|"vps"|"auto"}}: whether one file gets a VPS copy: "pc" means no VPS copy of it, "vps" or "auto" a copy like any file. The PC always keeps its own copy.`;
