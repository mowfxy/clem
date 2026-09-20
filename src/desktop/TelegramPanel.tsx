import { useEffect, useState } from "react";
import { desktop } from "./bridge";
export function TelegramPanel({ scope }: { scope: string }) {
  const [state, setState] = useState<{
      enabled: boolean;
      routes: { scope: string }[];
      error?: string;
    }>({ enabled: false, routes: [] }),
    [code, setCode] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const refresh = () =>
    desktop!.invoke({ action: "telegramStatus" }).then(setState);
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
    const timer = setInterval(() => void refresh().catch(() => {}), 10000);
    return () => clearInterval(timer);
  }, []);
  return (
    <details open className="desktop-folder-panel">
      <summary>Telegram</summary>
      <p>
        Connect your own bot from BotFather. Pair it with this space. Mowr must
        remain open on this PC to respond; Telegram retains pending updates for
        a limited time.
      </p>
      {state.enabled ? (
        <>
          <p>
            {state.routes.length
              ? "Paired with " + state.routes[0].scope
              : "Waiting for pairing."}
          </p>
          {code && (
            <p>
              Send this to your bot within five minutes:
              <br />
              <code>/start {code}</code>
            </p>
          )}
          <button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void desktop!
                .invoke({ action: "telegramDisconnect" })
                .then(() => {
                  setCode("");
                  return refresh();
                })
                .catch((e) => setError(e.message))
                .finally(() => setBusy(false));
            }}
          >
            Disconnect and forget token
          </button>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget,
              token = String(new FormData(form).get("token"));
            setBusy(true);
            void desktop!
              .invoke({ action: "telegramConnect", token, scope })
              .then(async (result) => {
                form.reset();
                setCode(result.code);
                await refresh();
              })
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          <label>
            Bot token
            <input name="token" type="password" autoComplete="off" required />
          </label>
          <button disabled={busy}>Connect to this space</button>
        </form>
      )}
      <p>
        Send text, JPEG/PNG images, PDFs, DOCX or plain text. Use /pdf before a
        request for a PDF reply. Files are limited to 20 MB; scanned PDFs need
        OCR.
      </p>
      {(error || state.error) && <p role="alert">{error || state.error}</p>}
    </details>
  );
}
