import { Illustration } from "../Illustrations";
import type { Scene } from "../vectorFilm";
import "./setup-illustration.css";
/** A complete still composition; entrance, settling and secondary motion are independent. */
export function SetupIllustration({ scene }: { scene: Scene }) {
  return (
    <div className={"setup-composition setup-composition-" + scene}>
      <svg
        className="setup-landscape"
        viewBox="0 0 480 390"
        fill="none"
        aria-hidden="true"
      >
        <path
          className="setup-orbit"
          d="M35 290C-20 110 232 25 387 98S445 331 240 343"
          stroke="currentColor"
          strokeDasharray="2 10"
          opacity=".22"
        />
        <g className="setup-page" transform="translate(35 200) rotate(-12)">
          <path
            d="M0 0H69L88 20V108H0Z"
            fill="#242723"
            stroke="#b8beb0"
            strokeWidth="1.5"
          />
          <path
            d="M69 0V20H88M15 38H69M15 51H60M15 64H68"
            stroke="#b8beb0"
            strokeWidth="2"
          />
          <circle cx="22" cy="85" r="6" fill="#a6bc8b" />
        </g>
        <g className="setup-note" transform="translate(364 104) rotate(9)">
          <rect width="76" height="65" rx="5" fill="#33352e" stroke="#a6bc8b" />
          <path d="M13 43L29 26L43 34L64 12" stroke="#a6bc8b" strokeWidth="2" />
          <path d="M14 12H34M14 19H27" stroke="#e5e5d8" opacity=".7" />
        </g>
        <g className="setup-star" transform="translate(110 81)">
          <path d="M0-9V9M-9 0H9" stroke="#c6bd8b" strokeWidth="2" />
          <circle cx="242" cy="205" r="4" fill="#8d9ad0" />
        </g>
        <path
          d="M40 353Q239 328 443 352M72 365Q235 347 409 365"
          stroke="currentColor"
          opacity=".16"
        />
      </svg>
      <Illustration scene={scene} />
    </div>
  );
}
