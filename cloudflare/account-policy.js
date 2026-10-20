export const ownerEmails = new Set([
  "m@mohamedmowafy.com",
  "mo.mowafymxis@gmail.com",
]);
export function normalizeUsername(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase();
}
export function validUsername(value) {
  return (
    /^[a-z][a-z0-9_]{2,23}$/.test(value) &&
    !["admin", "support", "clem", "system"].includes(value)
  );
}
export function ownerEligible(user) {
  return (
    !!user?.id &&
    !!user.email_confirmed_at &&
    !user.new_email &&
    ownerEmails.has(String(user.email).toLowerCase())
  );
}
export function subscriptionActive(subscription, now = Date.now()) {
  return (
    ["active", "cancelled"].includes(subscription?.status) &&
    Number.isFinite(Date.parse(subscription.valid_until)) &&
    Date.parse(subscription.valid_until) > now
  );
}
export async function verifySignature(raw, signature, secret) {
  if (!secret || !/^[a-f0-9]{64}$/i.test(signature || "")) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    Uint8Array.from(signature.match(/../g), (x) => parseInt(x, 16)),
    new TextEncoder().encode(raw),
  );
}
