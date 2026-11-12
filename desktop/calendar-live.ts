import {fromGoogle, type CalEvent} from "../core/proactivity/calendar.ts";

// Google Calendar (docs/MAIN-THREAD.md "Calendar, reminders and study time"): the person's own calendars, read straight
// from Google with a short-lived token Clem's service mints from the connection (calendar.readonly), and kept in memory
// for five minutes. The one thing Clem writes is its own "Clem" calendar (calendar.app.created), and only when the person
// turned on "Add reminders to Google Calendar": an event per reminder they set, with Google's own pop-up at the time.

const API = "https://www.googleapis.com/calendar/v3";
export const WRITE_SCOPE = "https://www.googleapis.com/auth/calendar.app.created";
/** How Clem knows its own calendar again (its description), and leaves it out of what it reads. */
const MARK = "Reminders you set in Clem. Clem adds and removes these; your other calendars are only read.";
const CACHE_MS = 5 * 60_000;
type ListEntry = {id?: string; summary?: string; summaryOverride?: string; description?: string; selected?: boolean; hidden?: boolean; accessRole?: string; primary?: boolean};

export class CalendarLive {
  private cached: {token: string; until: number; write: boolean} | null = null;
  private own: string | null = null;
  private known: {connected: boolean; at: number} | null = null;
  private events = new Map<string, {at: number; items: CalEvent[]}>();
  private generation = 0;
  private session: () => Promise<string | null>;
  private fetcher: typeof fetch;
  private service: string;
  constructor(session: () => Promise<string | null>, fetcher: typeof fetch = fetch, service = "https://clem.m4labs.xyz") { this.session = session; this.fetcher = fetcher; this.service = service; }

  /** Signed out, or another account: nothing from before stays. */
  forget() { this.cached = null; this.known = null; this.own = null; this.events.clear(); this.generation++; }

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
    const {accessToken, expiresIn, scope} = await r.json() as {accessToken: string; expiresIn: number; scope?: string};
    if (generation !== this.generation) throw Error("The account changed. Try again.");
    this.cached = {token: accessToken, until: Date.now() + Math.max(60, Number(expiresIn) - 120) * 1000, write: String(scope || "").split(/\s+/).includes(WRITE_SCOPE)};
    this.known = {connected: true, at: Date.now()};
    return accessToken;
  }
  private async google(url: string, retry = true, init: {method?: string; body?: unknown} = {}): Promise<Response | null> {
    const token = await this.token();
    if (!token) return null;
    const r = await this.fetcher(url, {method: init.method || "GET", headers: {Authorization: "Bearer " + token, ...(init.body ? {"Content-Type": "application/json"} : {})}, ...(init.body ? {body: JSON.stringify(init.body)} : {}), signal: AbortSignal.timeout(20_000)});
    if (r.status === 401 && retry) { this.cached = null; return this.google(url, false, init); }
    if (r.status === 403) {
      const reason = JSON.stringify(await r.clone().json().catch(() => ({})));
      if (/accessNotConfigured|SERVICE_DISABLED/i.test(reason)) throw Error("The Google Calendar API is switched off for Clem on Google's side, so the calendar can't be read yet.");
      // A write Clem may not make leaves the calendar connected for reading.
      if (/insufficient/i.test(reason)) { if (init.method && init.method !== "GET") { if (this.cached) this.cached.write = false; return null; } this.known = {connected: false, at: Date.now()}; return null; }
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
  /** `write`: the connection lets Clem add events to its own calendar (it was made after reminders could go to Google). */
  async state(refresh = false): Promise<{connected: boolean; checked: boolean; write?: boolean; error?: string}> {
    if (!refresh && this.known && Date.now() - this.known.at < 5 * 60_000) return {connected: this.known.connected, checked: true, write: this.known.connected && !!this.cached?.write};
    try { const on = !!await this.token(refresh); return {connected: on, checked: true, write: on && !!this.cached?.write}; }
    catch (e) { return {connected: this.known?.connected ?? false, checked: !!this.known, error: (e as Error).message}; }
  }

  /** Clem's own calendar in Google, made the first time it is needed. null: not connected, or no permission to write. */
  private async ownCalendar(): Promise<string | null> {
    if (!await this.token() || !this.cached?.write) return null;
    if (this.own) return this.own;
    const list = await this.google(`${API}/users/me/calendarList?minAccessRole=owner&maxResults=250`);
    if (!list) return null;
    if (!list.ok) throw Error("Google Calendar didn't list your calendars. Try again in a moment.");
    const found = ((await list.json() as {items?: ListEntry[]}).items || []).find((c) => c.id && c.description === MARK);
    if (found) return this.own = found.id!;
    const made = await this.google(`${API}/calendars`, true, {method: "POST", body: {summary: "Clem", description: MARK, timeZone: "Africa/Cairo"}});
    if (!made) return null;
    if (!made.ok) throw Error("Google Calendar didn't make Clem's calendar. Try again in a moment.");
    return this.own = (await made.json() as {id: string}).id;
  }
  /** Puts a reminder in Clem's calendar as a 15-minute event with a pop-up at its start; a repeating one repeats there
   *  too. The event's id, or null when Clem may not write. */
  async addReminder(e: {text: string; at: number; repeat?: "daily" | "weekly"}, retry = true): Promise<string | null> {
    const cal = await this.ownCalendar();
    if (!cal) return null;
    const zone = "Africa/Cairo", body = {summary: e.text.slice(0, 300), description: "A reminder you set in Clem.",
      start: {dateTime: new Date(e.at).toISOString(), timeZone: zone}, end: {dateTime: new Date(e.at + 15 * 60_000).toISOString(), timeZone: zone},
      reminders: {useDefault: false, overrides: [{method: "popup", minutes: 0}]}, ...(e.repeat ? {recurrence: [`RRULE:FREQ=${e.repeat === "daily" ? "DAILY" : "WEEKLY"}`]} : {})};
    const r = await this.google(`${API}/calendars/${encodeURIComponent(cal)}/events`, true, {method: "POST", body});
    if (!r) return null;
    // The person deleted Clem's calendar in Google: it is made again, once.
    if ((r.status === 404 || r.status === 410) && retry) { this.own = null; return this.addReminder(e, false); }
    if (!r.ok) throw Error("Google Calendar didn't take the reminder. It will be tried again.");
    return (await r.json() as {id: string}).id;
  }
  /** Takes a reminder's event out of Clem's calendar (one already gone is fine). */
  async removeReminder(id: string): Promise<void> {
    const cal = await this.ownCalendar();
    if (!cal) throw Error("Google Calendar isn't connected, so the reminder stays there for now.");
    const r = await this.google(`${API}/calendars/${encodeURIComponent(cal)}/events/${encodeURIComponent(id)}`, true, {method: "DELETE"});
    if (!r) throw Error("Google Calendar isn't connected, so the reminder stays there for now.");
    if (!r.ok && r.status !== 404 && r.status !== 410) throw Error("Google Calendar didn't remove the reminder. It will be tried again.");
  }

  /** Events from every calendar the person shows in Google Calendar, between two instants, soonest first. null when
   *  Calendar isn't connected. */
  async between(from: number, to: number): Promise<CalEvent[] | null> {
    const k = `${from}-${to}`, hit = this.events.get(k);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.items;
    const list = await this.google(`${API}/users/me/calendarList?minAccessRole=reader&maxResults=50`);
    if (!list) return null;
    if (!list.ok) throw Error("Google Calendar didn't list your calendars. Try again in a moment.");
    // Clem's own calendar holds its reminders, which are reminders already: read back, they would turn into deadlines.
    const calendars = ((await list.json() as {items?: ListEntry[]}).items || []).filter((c) => c.id && c.selected !== false && !c.hidden && c.description !== MARK).slice(0, 20);
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
