// The AI's VPS actions on the kinetra tool, only while a VPS is connected (docs/GUC-VPS-ENGINE.md "AI tools").
// Byte-stable guide, so prompt caching keeps it.
export const VPS_ACTIONS = ["vps.run_command", "vps.read_file", "vps.write_file", "vps.service_status", "vps.waiting", "vps.keep"] as const;
export const isVpsAction = (a: unknown): a is (typeof VPS_ACTIONS)[number] => typeof a === "string" && (VPS_ACTIONS as readonly string[]).includes(a);
export const VPS_GUIDE = `VPS: the person connected their own server. Use it only when they ask about it.
- {"kinetra":{"action":"vps.service_status"}}: Clem's worker, Docker or systemd, disk and memory.
- {"kinetra":{"action":"vps.run_command","command":"…"}}: read-only commands run at once (output capped). Anything that could change the server (installing a package, restarting a service, freeing disk space) is asked first: in the app it returns a vps_confirm card (put it in your reply and wait, the person taps Run it); on Telegram from the VPS, Clem asks in words with the exact command and runs it when the person says yes. Ask for what the request needs; never refuse it as impossible.
- {"kinetra":{"action":"vps.read_file","path":"…"}}: a text file (paths relative to their home folder unless absolute).
- {"kinetra":{"action":"vps.write_file","path":"…","content":"…"}}: writes a new file; replacing an existing one returns a vps_confirm card the same way.
- {"kinetra":{"action":"vps.waiting","send":true|false}}: files waiting past the VPS's storage limit (82% of its disk). With "send": the standing answer, true = they go to the PC whenever it's online (CMS files the VPS skipped too), false = they stay and Clem doesn't ask; the person's "yes"/"no" to Clem's question about it, or any later change of mind. Without "send": what waits and the answer in force.
- {"kinetra":{"action":"vps.keep","file":"<file name or id>","where":"pc"|"vps"|"auto"}}: where one file is kept, overriding the storage move: "pc" keeps it only on the PC (moved off the VPS when the PC is on), "vps" keeps it on the VPS, "auto" lets Clem decide again.`;
