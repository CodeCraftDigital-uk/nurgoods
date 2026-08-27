/**
 * Anti-spam controls for the public contact form. These are pure functions so
 * the guardrails can be proven without a network or a database.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const ORIGINAL = { ...process.env };

async function load() {
  return import("./contact.server");
}

beforeEach(() => {
  process.env["CONTACT_FORM_SECRET"] = "test-secret-value";
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("form timing token", () => {
  it("accepts a legitimate submission after the minimum completion time", async () => {
    const { issueFormToken, verifyFormToken } = await load();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-27T06:00:00Z"));
    const token = issueFormToken();
    vi.setSystemTime(new Date("2026-08-27T06:00:30Z"));
    expect(verifyFormToken(token)).toEqual({ ok: true, tooFast: false });
  });

  it("flags a submission completed far too quickly", async () => {
    const { issueFormToken, verifyFormToken } = await load();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-27T06:00:00Z"));
    const token = issueFormToken();
    vi.setSystemTime(new Date("2026-08-27T06:00:01Z"));
    expect(verifyFormToken(token)).toEqual({ ok: false, tooFast: true });
  });

  it("rejects a forged or tampered token", async () => {
    const { issueFormToken, verifyFormToken } = await load();
    const token = issueFormToken();
    const forged = `${token.split(".")[0]}.${"0".repeat(64)}`;
    expect(verifyFormToken(forged).ok).toBe(false);
    expect(verifyFormToken("nonsense").ok).toBe(false);
  });
});

describe("content filtering", () => {
  it("passes an ordinary customer enquiry", async () => {
    const { looksLikeSpam } = await load();
    expect(
      looksLikeSpam({
        name: "Amina Khan",
        subject: "Delivery date for order 1042",
        message:
          "Hello, I ordered the marinade injector last Tuesday and would like to know when it is due to arrive. Thank you.",
      }),
    ).toBe(false);
  });

  it("rejects link stuffed bodies", async () => {
    const { countLinks, looksLikeSpam } = await load();
    const message =
      "Buy now https://spam.example/one and https://spam.example/two and www.spam.example/three for cheap traffic today.";
    expect(countLinks(message)).toBe(3);
    expect(looksLikeSpam({ name: "Bot", subject: "SEO offer", message })).toBe(true);
  });

  it("rejects a link in the name field and injected markup", async () => {
    const { looksLikeSpam } = await load();
    expect(
      looksLikeSpam({
        name: "https://spam.example",
        subject: "hi",
        message: "A perfectly ordinary looking sentence that is long enough to pass validation.",
      }),
    ).toBe(true);
    expect(
      looksLikeSpam({
        name: "Bot",
        subject: "hi",
        message: '<a href="https://spam.example">click</a> for a great deal on backlinks today.',
      }),
    ).toBe(true);
  });
});

describe("privacy preserving fingerprints", () => {
  it("never returns the raw caller value and is stable", async () => {
    const { fingerprintHash } = await load();
    const hash = fingerprintHash("203.0.113.9");
    expect(hash).not.toContain("203.0.113.9");
    expect(hash).toHaveLength(48);
    expect(fingerprintHash("203.0.113.9")).toBe(hash);
    expect(fingerprintHash("203.0.113.10")).not.toBe(hash);
  });
});

describe("text hardening", () => {
  it("strips markup and blocks email header injection", async () => {
    const { headerSafe, plainText } = await load();
    expect(headerSafe("Order help\r\nBcc: victim@example.com", 140)).toBe(
      "Order help Bcc: victim@example.com",
    );
    expect(plainText("<script>alert(1)</script>hello", 100)).toBe("alert(1) hello");
  });
});

describe("optional Turnstile verification", () => {
  it("is not required when keys are absent", async () => {
    delete process.env["TURNSTILE_SITE_KEY"];
    delete process.env["TURNSTILE_SECRET_KEY"];
    const { turnstileRequired, turnstileSiteKey, verifyTurnstile } = await load();
    expect(turnstileRequired()).toBe(false);
    expect(turnstileSiteKey()).toBeNull();
    await expect(verifyTurnstile("", "203.0.113.9")).resolves.toBe(true);
  });

  it("verifies the token server side when keys are configured", async () => {
    process.env["TURNSTILE_SITE_KEY"] = "site";
    process.env["TURNSTILE_SECRET_KEY"] = "secret";
    const { turnstileRequired, verifyTurnstile } = await load();
    expect(turnstileRequired()).toBe(true);

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    await expect(verifyTurnstile("good-token", "203.0.113.9")).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      expect.objectContaining({ method: "POST" }),
    );

    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: false }), { status: 200 }));
    await expect(verifyTurnstile("bad-token", "203.0.113.9")).resolves.toBe(false);
    await expect(verifyTurnstile("", "203.0.113.9")).resolves.toBe(false);
  });
});

describe("persistent abuse controls", () => {
  /** Minimal stand in for the query builder used by checkAbuse. */
  function stubClient(rows: Record<string, unknown[]>) {
    const calls: string[] = [];
    return {
      calls,
      from() {
        const state = { kind: "" };
        const builder: Record<string, unknown> = {
          select: () => builder,
          eq: (column: string) => {
            state.kind = column === "content_hash" ? "duplicate" : "ip";
            return builder;
          },
          gte: (_column: string, value: string) => {
            const key =
              state.kind === "duplicate"
                ? "duplicate"
                : Date.now() - Date.parse(value) > 2 * 60 * 60 * 1000
                  ? "daily"
                  : "hourly";
            calls.push(key);
            const result = Promise.resolve({ data: rows[key] ?? [] });
            return Object.assign(result, { limit: () => result });
          },
        };
        return builder;
      },
    };
  }

  async function loadWith(rows: Record<string, unknown[]>) {
    const client = stubClient(rows);
    vi.resetModules();
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: client }));
    const mod = await import("./contact.server");
    return { checkAbuse: mod.checkAbuse, client };
  }

  it("allows a first time enquiry", async () => {
    const { checkAbuse } = await loadWith({});
    await expect(checkAbuse({ ipHash: "a", contentHash: "b" })).resolves.toEqual({
      allowed: true,
      duplicate: false,
    });
  });

  it("suppresses an identical repeat submission", async () => {
    const { checkAbuse } = await loadWith({ duplicate: [{ id: "1" }] });
    await expect(checkAbuse({ ipHash: "a", contentHash: "b" })).resolves.toEqual({
      allowed: false,
      duplicate: true,
    });
  });

  it("rate limits a sender that has already sent the hourly maximum", async () => {
    const { checkAbuse } = await loadWith({ hourly: [{ id: "1" }, { id: "2" }, { id: "3" }] });
    await expect(checkAbuse({ ipHash: "a", contentHash: "b" })).resolves.toEqual({
      allowed: false,
      duplicate: false,
    });
  });

  it("rate limits a sender that has reached the daily maximum", async () => {
    const daily = Array.from({ length: 10 }, (_, index) => ({ id: String(index) }));
    const { checkAbuse } = await loadWith({ daily });
    await expect(checkAbuse({ ipHash: "a", contentHash: "b" })).resolves.toEqual({
      allowed: false,
      duplicate: false,
    });
  });
});
