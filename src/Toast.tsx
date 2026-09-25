import { useLayoutEffect, useState } from "react";
import { Icon } from "./Icons";
import "./toast.css";

const PROBLEM = /\b(could ?n[o’']?t|cannot|can[’']t|failed|error|unavailable|missing|not (?:connected|available|found|supported|allowed)|no longer|isn[’']t|limit|too (?:large|long|many)|invalid|denied|offline|needs attention|try again)\b/i;

/** A short confirmation, centred over the workspace (not the whole window) near its top edge,
 *  so it never covers the message box and always appears in the same place. */
export function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const [center, setCenter] = useState<number | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const area = document.querySelector(".workspace")?.getBoundingClientRect();
      setCenter(area && area.width > 0 ? area.left + area.width / 2 : null);
    };
    place();
    addEventListener("resize", place);
    return () => removeEventListener("resize", place);
  }, [message]);
  const problem = PROBLEM.test(message);
  return <div className={"toast" + (problem ? " is-problem" : "")} role={problem ? "alert" : "status"} style={center === null ? undefined : { left: center }} key={message}>
    <span className="toast-mark" aria-hidden="true">{problem ? <b>!</b> : <Icon name="check" size={13} />}</span>
    <span className="toast-text">{message}</span>
    <button type="button" className="toast-close" aria-label="Dismiss notification" onClick={onDismiss}><Icon name="close" size={13} /></button>
  </div>;
}
