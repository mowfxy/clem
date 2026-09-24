import type { DesktopRequest } from "./contracts";
import type { DesktopAuth } from "./auth";
import type { User } from "@supabase/supabase-js";
export const securityActions = new Set([
  "securityInfo",
  "passwordChange",
  "passwordReauth",
  "emailChange",
  "revokeOtherSessions",
  "mfaEnroll",
  "mfaRemove",
  "unlinkGoogle",
]);
const hasPassword = (user: User) => !!user.identities?.some((i) => i.provider === "email");
/** Five wrong answers lock password changes for 15 minutes on this device. */
const attempts = new Map<string, { failures: number; until: number }>();
function throttle(id: string) {
  const entry = attempts.get(id);
  if (entry && entry.until > Date.now()) throw Error("Too many attempts. Try again in 15 minutes.");
}
function failed(id: string) {
  const entry = attempts.get(id) || { failures: 0, until: 0 };
  entry.failures++;
  if (entry.failures >= 5) { entry.failures = 0; entry.until = Date.now() + 15 * 60_000; }
  attempts.set(id, entry);
}
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
      password: hasPassword(user),
      factors:
        user.factors
          ?.filter((f) => f.status === "verified")
          .map((f) => ({
            id: f.id,
            name: f.friendly_name || "Authenticator",
          })) || [],
    };
  if (request.action === "passwordReauth") {
    if (hasPassword(user)) throw Error("Enter your current password instead.");
    throttle(user.id);
    const result = await auth.client!.auth.reauthenticate();
    if (result.error) throw Error("Could not send a verification code. Try again in a minute.");
    return { sent: true };
  }
  if (request.action === "passwordChange") {
    throttle(user.id);
    const mfa = user.factors?.find((f) => f.factor_type === "totp" && f.status === "verified");
    if (mfa && !request.code) throw Error("Enter the code from your authenticator app.");
    if (hasPassword(user)) {
      if (!request.currentPassword || !user.email) throw Error("Enter your current password.");
      if (request.currentPassword === request.password) throw Error("Choose a password you have not used for this account.");
      // Step-up on a separate, fresh session: the signed-in session is never replaced,
      // and the provider's recent-sign-in rule for password changes is satisfied.
      const verifier = auth.isolatedClient();
      const signIn = await verifier.auth.signInWithPassword({ email: user.email, password: request.currentPassword });
      if (signIn.error || signIn.data.user?.id !== user.id) { failed(user.id); throw Error("Your current password is incorrect."); }
      try {
        if (mfa) {
          const step = await verifier.auth.mfa.challengeAndVerify({ factorId: mfa.id, code: request.code! });
          if (step.error) { failed(user.id); throw Error("That authenticator code is incorrect or expired."); }
        }
        const result = await verifier.auth.updateUser({ password: request.password });
        if (result.error) throw Error(result.error.message);
      } finally {
        await verifier.auth.signOut({ scope: "local" }).catch(() => {});
      }
    } else {
      // Accounts created with Google have no password yet: prove control of the email address.
      if (!request.nonce) throw Error("Enter the verification code we emailed you.");
      if (mfa) {
        const step = await auth.client!.auth.mfa.challengeAndVerify({ factorId: mfa.id, code: request.code! });
        if (step.error) { failed(user.id); throw Error("That authenticator code is incorrect or expired."); }
      }
      const result = await auth.client!.auth.updateUser({ password: request.password, nonce: request.nonce });
      if (result.error) { failed(user.id); throw Error(/nonce|otp|token/i.test(result.error.message) ? "That email code is incorrect or expired." : result.error.message); }
    }
    attempts.delete(user.id);
    // Anyone holding an old session elsewhere is signed out; this device stays signed in.
    await auth.client!.auth.signOut({ scope: "others" }).catch(() => {});
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
    throttle(user.id);
    const verifier = auth.isolatedClient();
    const verified = await verifier.auth.signInWithPassword({
      email: user.email,
      password: request.password,
    });
    await verifier.auth.signOut({ scope: "local" }).catch(() => {});
    if (verified.error || verified.data.user.id !== user.id) {
      failed(user.id);
      throw Error("Set and verify a working password before unlinking Google.");
    }
    const result = await auth.client!.auth.unlinkIdentity(identity);
    if (result.error) throw Error(result.error.message);
    return { ok: true };
  }
}
