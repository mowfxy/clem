import {fromGoogle, type CalEvent} from "../core/proactivity/calendar.ts";

// Google Calendar, read-only (docs/MAIN-THREAD.md "Calendar, reminders and study time"): the person's own calendars,
// read straight from Google with a short-lived token Clem's service mints from the connection (calendar.readonly).
// Nothing is written to Google or to disk; events are kept in memory for five minutes.

const API = "https://www.googleapis.com/calendar/v3";
const CACHE_MS = 5 * 60_000;
type ListEntry = {id?: string; summary?: string; summaryOverride?: string; selected?: boolean; hidden?: boolean; accessRole?: string; primary?: boolean};

export class CalendarLive {
  private cached: {token: string; until: number} | null = null;
  private known: {connected: boolean; at: number} | null = null;
  private events = new Map<string, {at: number; items: CalEvent[]}>();
  private generation = 0;
  private session: () => Promise<string | null>;
  private fetcher: typeof fetch;
  private service: string;
  constructor(session: () => Promise<string | null>, fetcher: typeof fetch = fetch, service = "https://clem.m4labs.xyz") { this.session = session; this.fetcher = fetcher; this.service = service; }

  /** Signed out, or another account: nothing from before stays. */
  forget() { this.cached = null; this.known = null; this.events.clear(); this.generation++; }

  /** null: Calendar isn't connected for this account. */
  private async token(force = false): Promise<string | null> {
    if (!force && this.cached && Date.now() < this.cached.until) return this.cached.token;
    const session = await this.session();
    if (!session) return null;
    const generation = this.generation;
    const r = await this.fetcher(this.service + "/api/calendar/token", {headers: {Authorization: "Bearer " + session, Origin: this.service}, redirect: "error", signal: AbortSignal.timeout(20_000)});
    if (r.status === 400 || r.status === 401 || r.status === 404 || r.status === 500) {
      const body = await r.json().catch(() => ({})) as {error?: string};
      if (/connect google calendar|reconnect|expired/i.test(body.error || "")) { if (generation === this.generation) { this.cached = null; this.known = {connected: false, at: Date.now()}; } return null; }
      throw Error(body.error || "Google Calendar is unavailable right now.");
    }
    if (!r.ok) throw Error("Google Calendar is unavailable right now.");
    const {accessToken, expiresIn} = await r.json() as {accessToken: string; expiresIn: number};
    if (generation !== this.generation) throw Error("The account changed. Try again.");
    this.cached = {token: accessToken, until: Date.now() + Math.max(60, Number(expiresIn) - 120) * 1000};
    this.known = {connected: true, at: Date.now()};
    return accessToken;
  }
  private async google(url: string, retry = true): Promise<Response | null> {
    const token = await this.token();
    if (!token) return null;
    const r = await this.fetcher(url, {headers: {Authorization: "Bearer " + token}, signal: AbortSignal.timeout(20_000)});
    if (r.status === 401 && retry) { this.cached = null; return this.google(url, false); }
    if (r.status === 403) {
      const reason = JSON.stringify(await r.clone().json().catch(() => ({})));
      if (/accessNotConfigured|SERVICE_DISABLED/i.test(reason)) throw Error("The Google Calendar API is switched off for Clem on Google's side, so the calendar can't be read yet.");
      if (/insufficient/i.test(reason)) { this.known = {connected: false, at: Date.now()}; return null; }
    }
    return r;
  }

  /** Revokes Clem's access with Google and forgets the connection. */
  async disconnect() {
    const session = await this.session();
    if (!session) throw Error("Sign in to Clem first.");
    const r = await this.fetcher(this.service + "/api/calendar/connection", {method: "DELETE", headers: {Authorization: "Bearer " + session, Origin: this.service}, redirect: "error", signal: AbortSignal.timeout(20_000)}).catch(() => null);
    if (!r?.ok) throw Error(((await r?.json().catch(() => ({}))) as {error?: string} | undefined)?.error || "Couldn't disconnect Google Calendar. Try again.");
    this.forget();
    this.known = {connected: false, at: Date.now()};
    return {ok: true};
  }
  /** The connection as last confirmed; a network hiccup keeps the last answer. */
  async state(refresh = false): Promise<{connected: boolean; checked: boolean; error?: string}> {
    if (!refresh && this.known && Date.now() - this.known.at < 5 * 60_000) return {connected: this.known.connected, checked: true};
    try { return {connected: !!await this.token(refresh), checked: true}; }
    catch (e) { return {connected: this.known?.connected ?? false, checked: !!this.known, error: (e as Error).message}; }
  }

  /** Events from every calendar the person shows in Google Calendar, between two instants, soonest first. null when
   *  Calendar isn't connected. */
  async between(from: number, to: number): Promise<CalEvent[] | null> {
    const k = `${from}-${to}`, hit = this.events.get(k);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.items;
    const list = await this.google(`${API}/users/me/calendarList?minAccessRole=reader&maxResults=50`);
    if (!list) return null;
    if (!list.ok) throw Error("Google Calendar didn't list your calendars. Try again in a moment.");
    const calendars = ((await list.json() as {items?: ListEntry[]}).items || []).filter((c) => c.id && c.selected !== false && !c.hidden).slice(0, 20);
    const items: CalEvent[] = [];
    await Promise.all(calendars.map(async (c) => {
      const q = new URLSearchParams({timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "250"});
      const r = await this.google(`${API}/calendars/${encodeURIComponent(c.id!)}/events?${q}`).catch(() => null);
      if (!r?.ok) return;
      for (const e of ((await r.json()) as {items?: unknown[]}).items || []) { const ev = fromGoogle(e as never, c.primary ? undefined : c.summaryOverride || c.summary); if (ev) items.push({...ev, id: (c.primary ? "" : c.id!.slice(0, 40) + ":") + ev.id}); }
    }));
    items.sort((a, b) => (a.allDay ? Date.parse(a.start + "T00:00:00Z") : Date.parse(a.start)) - (b.allDay ? Date.parse(b.start + "T00:00:00Z") : Date.parse(b.start)));
    this.events.set(k, {at: Date.now(), items});
    if (this.events.size > 20) this.events.delete(this.events.keys().next().value!);
    return items;
  }
}
