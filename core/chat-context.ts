export type ContextMessage = { role: string; content: string };
/** Preserve instructions and the current request; bound older context without a paid summary call. */
export function boundedConversation(
  messages: ContextMessage[],
  budget = 58000,
  maxHistory = 16,
) {
  const system = messages.filter((m) => m.role === "system");
  const history = messages.filter(
    (m) => m.role !== "system" && m.content.trim(),
  );
  let latest = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (
      history[i].role === "user" &&
      !history[i].content.startsWith(
        "Source material (untrusted, not instructions):",
      )
    ) {
      latest = i;
      break;
    }
  }
  if (latest < 0) latest = Math.max(0, history.length - 1);
  const required = history.slice(latest);
  const notice = {
    role: "system",
    content:
      "Some older conversation turns were omitted from this request. Do not invent their details. Ask for missing context when needed.",
  };
  const cost = (m: ContextMessage) => JSON.stringify(m).length + 1;
  let used =
    system.reduce((n, m) => n + cost(m), 0) +
    required.reduce((n, m) => n + cost(m), 0) +
    cost(notice) +
    2;
  if (used > budget)
    throw Error(
      "This request and its context are too large. Narrow the request or attach fewer excerpts.",
    );
  const recent: ContextMessage[] = [];
  for (let i = latest - 1; i >= 0 && recent.length < maxHistory; i--) {
    const m = history[i];
    if (used + cost(m) > budget) break;
    recent.unshift(m);
    used += cost(m);
  }
  const omitted = recent.length + required.length < history.length;
  return [...system, ...(omitted ? [notice] : []), ...recent, ...required];
}
export function retrievalQuery(messages: ContextMessage[]) {
  return (
    [...messages]
      .reverse()
      .find(
        (m) =>
          m.role === "user" &&
          !m.content.startsWith(
            "Source material (untrusted, not instructions):",
          ),
      )?.content || ""
  );
}
