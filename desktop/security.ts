import type { DesktopRequest } from "./contracts";
import type { DesktopAuth } from "./auth";
import type { User } from "@supabase/supabase-js";
export const securityActions = new Set([
  "securityInfo",
  "passwordChange",
  "emailChange",
  "revokeOtherSessions",
  "mfaEnroll",
  "mfaRemove",
  "unlinkGoogle",
]);
export async function handleSecurity(
  auth: DesktopAuth,
  user: User,
  request: DesktopRequest,
) {
  if (request.action === "securityInfo")
    return {
      email: user.email,
      verified: !!user.email_confirmed_at,
      google: user.identities?.some((i) => i.provider === "google"),
      factors:
        user.factors
          ?.filter((f) => f.status === "verified")
          .map((f) => ({
            id: f.id,
            name: f.friendly_name || "Authenticator",
          })) || [],
    };
  if (request.action === "passwordChange") {
    const result = await auth.client!.auth.updateUser({
      password: request.password,
    });
    if (result.error) throw Error(result.error.message);
    return { ok: true };
  }
  if (request.action === "emailChange") {
    const result = await auth.client!.auth.updateUser(
      { email: request.email },
      { emailRedirectTo: "https://mowrai.com/" },
    );
    if (result.error) throw Error(result.error.message);
    return { ok: true };
  }
  if (request.action === "revokeOtherSessions") {
    const result = await auth.client!.auth.signOut({ scope: "others" });
    if (result.error) throw Error(result.error.message);
    return { ok: true };
  }
  if (request.action === "mfaEnroll") {
    const result = await auth.client!.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Mowr authenticator",
    });
    if (result.error) throw Error(result.error.message);
    return { id: result.data.id, qr: result.data.totp.qr_code };
  }
  if (request.action === "mfaRemove") {
    const challenge = await auth.client!.auth.mfa.challengeAndVerify({
      factorId: request.factorId,
      code: request.code,
    });
    if (challenge.error)
      throw Error("Verify your authenticator before removing it.");
    const result = await auth.client!.auth.mfa.unenroll({
      factorId: request.factorId,
    });
    if (result.error) throw Error(result.error.message);
    return { ok: true };
  }
  if (request.action === "unlinkGoogle") {
    const identity = user.identities?.find((i) => i.provider === "google");
    if (!identity || !user.email) throw Error("Google is not linked.");
    const verified = await auth.client!.auth.signInWithPassword({
      email: user.email,
      password: request.password,
    });
    if (verified.error || verified.data.user.id !== user.id)
      throw Error("Set and verify a working password before unlinking Google.");
    const result = await auth.client!.auth.unlinkIdentity(identity);
    if (result.error) throw Error(result.error.message);
    return { ok: true };
  }
}
