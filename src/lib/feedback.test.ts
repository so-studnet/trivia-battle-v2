import { describe, expect, it, vi } from "vitest";
import { buildFeedbackMail, parseFeedbackRequest, sendWithResend } from "./feedback";

describe("parseFeedbackRequest", () => {
  it("内容を整え、おかしな token は捨てる", () => {
    expect(parseFeedbackRequest({ message: "  ありがとう  ", token: "abc", page: "title" })).toEqual({
      token: null,
      message: "ありがとう",
      page: "title",
      honeypot: false,
    });
    const t = "11111111-1111-4111-8111-111111111111";
    expect(parseFeedbackRequest({ message: "x", token: t })?.token).toBe(t);
  });

  it("空・長すぎる・形が違うものは受け付けない", () => {
    expect(parseFeedbackRequest(null)).toBeNull();
    expect(parseFeedbackRequest({ message: "   " })).toBeNull();
    expect(parseFeedbackRequest({ message: "あ".repeat(2001) })).toBeNull();
    expect(parseFeedbackRequest({ message: 1 })).toBeNull();
  });

  it("おとり欄が埋まっていたらボットとみなす", () => {
    expect(parseFeedbackRequest({ message: "x", website: "http://spam" })?.honeypot).toBe(true);
  });
});

describe("buildFeedbackMail", () => {
  it("送り主・画面・内容を書いたメールにする", () => {
    const mail = buildFeedbackMail(
      {
        message: "問題が面白い\n2行目",
        page: "stats",
        nickname: "アリス",
        email: "a@example.com",
        id: "f1",
        receivedAt: new Date("2026-11-09T03:00:00Z"),
      },
      { from: "x <onboarding@resend.dev>", to: "me@example.com" },
    );
    expect(mail.to).toEqual(["me@example.com"]);
    expect(mail.subject).toBe("【雑学カードバトル】フィードバック: 問題が面白い");
    expect(mail.text).toContain("アリス（a@example.com）");
    expect(mail.text).toContain("2026/11/9 12:00:00");
    expect(mail.text).toContain("問題が面白い\n2行目");
  });

  it("ログインしていない人からのもの", () => {
    const mail = buildFeedbackMail(
      { message: "あ".repeat(40), page: null, nickname: null, email: null, id: "f2", receivedAt: new Date() },
      { from: "f", to: "t" },
    );
    expect(mail.text).toContain("ログインしていない人");
    expect(mail.subject.endsWith("…")).toBe(true);
  });
});

describe("sendWithResend", () => {
  it("API キーを付けて送り、失敗したら例外にする", async () => {
    const ok = vi.fn(async () => new Response("{}", { status: 200 }));
    await sendWithResend({ from: "f", to: ["t"], subject: "s", text: "b" }, "re_key", ok as unknown as typeof fetch);
    const [url, init] = ok.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_key");
    const ng = vi.fn(async () => new Response("bad", { status: 403 }));
    await expect(sendWithResend({ from: "f", to: ["t"], subject: "s", text: "b" }, "k", ng as unknown as typeof fetch)).rejects.toThrow("403");
  });
});
