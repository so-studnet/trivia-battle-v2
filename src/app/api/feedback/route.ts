// フィードバックの受け付け。Supabase に保存してから、Resend で開発者にメールを送る。
// 必要な環境変数（Vercel に設定。NEXT_PUBLIC_ は付けない）:
//   RESEND_API_KEY      Resend の API キー（秘密）
//   FEEDBACK_TO_EMAIL   届け先のメールアドレス（Resend に登録したアドレス）
//   FEEDBACK_FROM_EMAIL 送り主（省略時は Resend の onboarding@resend.dev）
import { createClient } from "@supabase/supabase-js";
import { buildFeedbackMail, parseFeedbackRequest, sendWithResend } from "@/lib/feedback";

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

export async function POST(request: Request) {
  const input = parseFeedbackRequest(await request.json().catch(() => null));
  if (!input) return json({ error: "invalid_message" }, 400);
  // ボットには成功したふりをする
  if (input.honeypot) return json({ saved: true, emailed: false });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return json({ error: "not_configured" }, 503);

  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.rpc("trivia_battle_save_feedback", {
    p_token: input.token,
    p_message: input.message,
    p_page: input.page,
  });
  if (error) {
    const status = /too_many/.test(error.message) ? 429 : /invalid/.test(error.message) ? 400 : 500;
    if (status === 500) console.error("feedback save failed", error);
    return json({ error: error.message }, status);
  }
  const saved = data as { id: string; email: string | null; nickname: string | null };

  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.FEEDBACK_TO_EMAIL;
  if (!apiKey || !to) return json({ saved: true, emailed: false });
  try {
    await sendWithResend(
      buildFeedbackMail(
        { message: input.message, page: input.page, nickname: saved.nickname, email: saved.email, id: saved.id, receivedAt: new Date() },
        { to, from: process.env.FEEDBACK_FROM_EMAIL || "雑学カードバトル <onboarding@resend.dev>" },
      ),
      apiKey,
    );
    return json({ saved: true, emailed: true });
  } catch (e) {
    // 保存はできているので、利用者には成功として返す
    console.error("feedback mail failed", e);
    return json({ saved: true, emailed: false });
  }
}
