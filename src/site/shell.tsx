import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { MARK_PATH } from '../../core/mark';
import { Icon } from '../Icons';
import { Horizon } from './Horizon';
import './site.css';

/** The public site's frame: the app's mark and lowercase serif wordmark, three links and the download. */

export type Release = { version: string; url: string; signed: boolean; sha256: string; size: number; released?: string };

let releaseOnce: Promise<Release | null> | undefined;
/** What /desktop-release.json says about the current Windows installer, fetched once per visit. */
export function useRelease() {
  const [release, setRelease] = useState<Release | null>(null);
  useEffect(() => {
    let live = true;
    releaseOnce ??= fetch('/desktop-release.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    void releaseOnce.then((r) => { if (live) setRelease(r); });
    return () => { live = false; };
  }, []);
  return release;
}

export const megabytes = (bytes: number) => `${Math.round(bytes / 1e5) / 10} MB`;

export function usePageTitle(title: string, description?: string) {
  useEffect(() => {
    document.title = title;
    if (description) document.querySelector('meta[name="description"]')?.setAttribute('content', description);
    window.scrollTo(0, 0);
  }, [title, description]);
}

/** Things that arrive once as they come into view. Without IntersectionObserver, or with reduced motion, they are simply there. */
export function useArrivals(root: React.RefObject<HTMLElement | null>, key = '') {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const items = [...el.querySelectorAll<HTMLElement>('[data-arrive]')];
    if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) { items.forEach((i) => i.classList.add('is-in')); return; }
    const seen = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-in'); seen.unobserve(e.target); } }), { rootMargin: '0px 0px -12% 0px' });
    items.forEach((i) => seen.observe(i));
    return () => seen.disconnect();
  }, [root, key]);
}

export function Mark({ size = 22 }: { size?: number }) {
  return <svg className="cs-mark" width={size} height={size} viewBox="0 0 100 100" aria-hidden="true"><path d={MARK_PATH} fill="currentColor" fillRule="evenodd" /></svg>;
}

export function DownloadButton({ label = 'Download for Windows', small = false }: { label?: string; small?: boolean }) {
  return <a className={'cs-get' + (small ? ' is-small' : '')} href="/download/windows"><Icon name="download" size={small ? 16 : 18} /><span>{label}</span></a>;
}

const NAV: [string, string][] = [['#/features', 'Features'], ['#/about', 'About'], ['#/support', 'Support']];

function Top({ route }: { route: string }) {
  return (
    <header className="cs-top">
      <a className="cs-brand" href="#/" aria-label="Clem, home"><Mark size={23} /><span className="cs-wordmark">clem</span></a>
      <nav aria-label="Site">
        {NAV.map(([href, label]) => <a key={href} href={href} className={'cs-nav' + (route.startsWith(href.slice(1)) ? ' is-here' : '')} aria-current={route.startsWith(href.slice(1)) ? 'page' : undefined}>{label}</a>)}
      </nav>
      <DownloadButton label="Download" small />
    </header>
  );
}

function Foot() {
  return (
    <footer className="cs-foot">
      <p>Made by <a href="https://m4labs.xyz">M4 Labs</a></p>
      <nav aria-label="More">
        <a href="https://github.com/mowfxy/clem">Source</a>
        <a href="https://github.com/mowfxy/clem-releases/releases">Releases</a>
        <a href="https://github.com/mowfxy/clem/issues">Report a problem</a>
        <a href="https://m4labs.xyz/privacy">Privacy</a>
        <a href="https://m4labs.xyz/terms">Terms</a>
      </nav>
    </footer>
  );
}

/** Like the app, the site follows the system's light or dark setting. */
function useNight() {
  const [night, setNight] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)'), on = () => setNight(query.matches);
    query.addEventListener('change', on);
    return () => query.removeEventListener('change', on);
  }, []);
  return night;
}
const Night = createContext(false);

/** Every public page sits in this frame: the app's sky behind the top of the page, the app's theme over it. */
export function SitePage({ route, children, className = '' }: { route: string; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null), night = useNight();
  useArrivals(ref, route);
  useEffect(() => {
    document.documentElement.dataset.theme = night ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', night ? '#05080f' : '#e9eff6');
  }, [night]);
  return (
    <Night.Provider value={night}>
      <div className={'cs ' + (night ? 'is-night ' : '') + className} ref={ref}>
        <Horizon day={!night} />
        <a className="cs-skip" href="#cs-main" onClick={(e) => { e.preventDefault(); document.getElementById('cs-main')?.focus(); }}>Skip to content</a>
        <Top route={route} />
        <main id="cs-main" tabIndex={-1}>{children}</main>
        <Foot />
      </div>
    </Night.Provider>
  );
}

/** Each is captured in the light theme (`-day`) and the dark one (scripts/site/capture.mjs). */
export type Shot = 'home' | 'thread' | 'chat' | 'cited' | 'visual' | 'ringing' | 'subjects' | 'subject' | 'flashcards' | 'plan' | 'files' | 'models';

/** A real capture of the desktop app: always the whole window, never cropped. */
export function Window({ shot, alt, caption, eager = false, className = '' }: { shot: Shot; alt: string; caption?: ReactNode; eager?: boolean; className?: string }) {
  // On a phone the window keeps a readable size and slides; it starts on its content, not on the sidebar.
  const file = `/shots/${shot}${useContext(Night) ? '' : '-day'}`, pane = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = pane.current; if (el && el.scrollWidth > el.clientWidth + 8) el.scrollLeft = (el.scrollWidth - el.clientWidth) * 0.66; }, [shot]);
  return (
    <figure className={'cs-window ' + className} data-arrive>
      <div className="cs-pane" ref={pane}><img src={`${file}-1440.webp`} srcSet={`${file}-1440.webp 1440w, ${file}-2878.webp 2878w`} sizes="(min-width: 1400px) 1320px, (min-width: 641px) 94vw, 780px" width={1440} height={SHOT_HEIGHT} alt={alt} loading={eager ? 'eager' : 'lazy'} decoding="async" /></div>
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}
/** The captures' height at 1440 wide (all windows are captured at one size). */
export const SHOT_HEIGHT = 853;
