// フィードバックの受け付けとメールの組み立て（サーバー側で使う）。
import { MAX_FEEDBACK_LENGTH } from "@/lib/room/types";

export interface FeedbackRequest {
  token: string | null;
  message: string;
  page: string | null;
  /** ボット対策のおとり欄。人は入力しない */
  honeypot: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 受け取った JSON を確かめる。おかしければ null */
export function parseFeedbackRequest(body: unknown): FeedbackRequest | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const message = typeof b.message === "string" ? b.message.trim() : "";
  if (!message || message.length > MAX_FEEDBACK_LENGTH) return null;
  return {
    token: typeof b.token === "string" && UUID.test(b.token) ? b.token : null,
    message,
    page: typeof b.page === "string" ? b.page.slice(0, 200) : null,
    honeypot: typeof b.website === "string" && b.website.length > 0,
  };
}

export interface Mail {
  from: string;
  to: string[];
  subject: string;
  text: string;
}

export function buildFeedbackMail(
  input: { message: string; page: string | null; nickname: string | null; email: string | null; id: string; receivedAt: Date },
  addresses: { from: string; to: string },
): Mail {
  const who = input.nickname ? `${input.nickname}（${input.email ?? "メール不明"}）` : "ログインしていない人";
  const firstLine = input.message.split("\n")[0].slice(0, 30);
  return {
    from: addresses.from,
    to: [addresses.to],
    subject: `【雑学カードバトル】フィードバック: ${firstLine}${input.message.length > 30 ? "…" : ""}`,
    text: [
      "雑学カードバトルにフィードバックが届きました。",
      "",
      `送った人: ${who}`,
      `画面: ${input.page ?? "不明"}`,
      `日時: ${input.receivedAt.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}`,
      `ID: ${input.id}`,
      "",
      "----- 内容 -----",
      input.message,
      "----------------",
      "",
      "（送った人のメールアドレスは確認されていないため、実在しない場合があります）",
    ].join("\n"),
  };
}

/** Resend の API でメールを送る */
export async function sendWithResend(mail: Mail, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const res = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(mail),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${detail.slice(0, 200)}`);
  }
}
