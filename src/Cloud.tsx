import {signOutSupabase} from './supabase';
import {desktop} from './desktop/bridge';
export type Session = {
  user: { id: string; name: string; email?: string } | null;
  database: boolean;
  auth: boolean;
  storage: boolean;
  drive: boolean;
  scheduler: boolean;
};
export const defaultSession: Session = {
  user: null,
  database: false,
  auth: false,
  storage: false,
  drive: false,
  scheduler: false,
};
export async function api<T = Record<string, unknown>>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  if(path==="auth/logout"&&desktop){await desktop.invoke({action:'logout'});location.reload();return {} as T;}
  if(path==="auth/logout")await signOutSupabase();
  const r = await fetch("/api/" + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await r.json();
  if (!r.ok) throw new Error(json.error || "Request failed.");
  return json;
}
