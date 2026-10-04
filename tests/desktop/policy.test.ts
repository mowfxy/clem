import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeUsername,
  validUsername,
  ownerEligible,
  subscriptionActive,
  verifySignature,
} from "../../cloudflare/account-policy.js";
import { requestSchema } from "../../desktop/contracts.ts";
test("username normalization is canonical and reserved names are rejected", () => {
  assert.equal(normalizeUsername(" Ｍowafy "), "mowafy");
  assert.ok(validUsername("mowafy_1"));
  assert.ok(!validUsername("admin"));
  assert.ok(!validUsername("two words"));
});
test("owner exemption requires a verified identity and rejects pending email changes", () => {
  const user = { id: "immutable-id", email: "m@mohamedmowafy.com" };
  assert.ok(!ownerEligible(user));
  assert.ok(ownerEligible({ ...user, email_confirmed_at: "2026-09-19" }));
  assert.ok(
    !ownerEligible({
      ...user,
      email_confirmed_at: "2026-09-19",
      new_email: "attacker@example.com",
    }),
  );
  assert.ok(
    !ownerEligible({ ...user, id: "", email_confirmed_at: "2026-09-19" }),
  );
});
test("pending, expired and delinquent payments cannot enable access", () => {
  const valid_until = "2030-01-01T00:00:00Z";
  for (const status of ["past_due", "unpaid", "expired", "paused", "pending"])
    assert.ok(!subscriptionActive({ status, valid_until }));
  assert.ok(subscriptionActive({ status: "cancelled", valid_until }));
  assert.ok(
    !subscriptionActive({ status: "active", valid_until: "2020-01-01" }),
  );
});
test("webhook MAC rejects modified payload and invalid signatures", async () => {
  const raw = '{"status":"active"}',
    secret = "test-only-webhook-secret";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = Buffer.from(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)),
  ).toString("hex");
  assert.ok(await verifySignature(raw, signature, secret));
  assert.ok(!(await verifySignature(raw + " ", signature, secret)));
  assert.ok(!(await verifySignature(raw, "", secret)));
});
test("desktop bridge rejects arbitrary tools, paths and unbounded messages", () => {
  assert.ok(
    !requestSchema.safeParse({ action: "shell", command: "whoami" }).success,
  );
  assert.ok(
    !requestSchema.safeParse({ action: "linkFolder", scope: "../../escape" })
      .success,
  );
  assert.ok(
    !requestSchema.safeParse({
      action: "chat",
      id: crypto.randomUUID(),
      scope: "chat:test",
      messages: [{ role: "user", content: "x".repeat(1_000_001) }],
    }).success,
  );
  // Whole long files fit in one message; the request is still bounded.
  assert.ok(requestSchema.safeParse({ action: "chat", id: crypto.randomUUID(), scope: "chat:test", messages: [{ role: "user", content: "x".repeat(600_000) }] }).success);
  // A long chat is sent whole (the main process condenses it); the request is still bounded.
  const many = (length: number) => requestSchema.safeParse({ action: "chat", id: crypto.randomUUID(), scope: "chat:test", messages: Array.from({ length }, () => ({ role: "user", content: "x" })) }).success;
  assert.ok(many(2000));
  assert.ok(!many(2001));
});
