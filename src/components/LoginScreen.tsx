"use client";

import { type FormEvent, useState } from "react";
import type { RoomSession } from "@/lib/room/session";
import { MAX_NAME_LENGTH, isValidEmail, normalizeEmail } from "@/lib/room/types";
import { Button, Logo, Panel, Spinner } from "./ui";

const NAME_KEY = "trivia-battle:name";

/** 前のバージョンで入力していた名前（登録のときの初期値にする） */
function legacyName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function LoginScreen({
  session,
  busy,
  error,
  onFeedback,
}: {
  session: RoomSession;
  busy: boolean;
  error: string | null;
  onFeedback: () => void;
}) {
  const [step, setStep] = useState<"email" | "register">("email");
  const [email, setEmail] = useState("");
  const [nickname, setNickname] = useState("");

  const normalized = normalizeEmail(email);
  const emailOk = isValidEmail(normalized);

  const submitEmail = async (e: FormEvent) => {
    e.preventDefault();
    if (!emailOk || busy) return;
    const status = await session.login(normalized);
    if (status === "new") {
      setNickname((n) => n || legacyName());
      setStep("register");
    }
  };

  const submitRegister = async (e: FormEvent) => {
    e.preventDefault();
    if (!nickname.trim() || busy) return;
    await session.register(normalized, nickname);
  };

  return (
    <main className="flex flex-1 flex-col justify-center gap-6 py-6">
      <header className="animate-fade-up text-center">
        <Logo />
        <h1 className="text-3xl font-black tracking-tight sm:text-4xl">雑学カードバトル</h1>
        <p className="mt-2 text-sm text-muted">本当？ウソ？ 友だちと雑学で対戦しよう</p>
      </header>

      <Panel className="animate-fade-up">
        {step === "email" ? (
          <form onSubmit={submitEmail} className="flex flex-col gap-4">
            <div>
              <h2 className="text-lg font-black">ログイン</h2>
              <p className="mt-1 text-sm text-muted">
                メールアドレスだけではじめられます。パスワードはいりません。はじめての人は、このあと登録します。
              </p>
            </div>
            <label className="flex flex-col gap-2">
              <span className="text-sm font-bold text-muted">メールアドレス</span>
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  session.clearError();
                }}
                placeholder="you@example.com"
                className="h-12 rounded-2xl border-2 border-border bg-surface-2 px-4 text-base font-bold outline-none focus:border-primary"
              />
            </label>
            <Button type="submit" className="w-full text-lg" disabled={!emailOk || busy}>
              {busy && <Spinner className="border-white/40 border-t-white" />}
              次へ
            </Button>
          </form>
        ) : (
          <form onSubmit={submitRegister} className="flex flex-col gap-4">
            <div>
              <h2 className="text-lg font-black">はじめまして！</h2>
              <p className="mt-1 text-sm text-muted">
                <b className="break-all text-text">{normalized}</b> で登録します。対戦で表示されるニックネームを決めてください（あとから変えられます）。
              </p>
            </div>
            <label className="flex flex-col gap-2">
              <span className="text-sm font-bold text-muted">ニックネーム</span>
              <input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                maxLength={MAX_NAME_LENGTH}
                placeholder="ニックネーム"
                autoComplete="nickname"
                autoFocus
                className="h-12 rounded-2xl border-2 border-border bg-surface-2 px-4 text-base font-bold outline-none focus:border-primary"
              />
            </label>
            <Button type="submit" className="w-full text-lg" disabled={!nickname.trim() || busy}>
              {busy && <Spinner className="border-white/40 border-t-white" />}
              登録してはじめる
            </Button>
            <Button variant="ghost" className="min-h-10 text-sm" onClick={() => setStep("email")}>
              ← メールアドレスを直す
            </Button>
          </form>
        )}
        {error && (
          <p role="alert" className="mt-4 rounded-xl bg-false-soft px-3 py-2 text-sm font-bold text-false">
            {error}
          </p>
        )}
      </Panel>

      <div className="flex flex-col gap-2 text-xs leading-relaxed text-muted">
        <p>
          確認メールは送られません。このブラウザではログインしたままになるので、次からは入力を省けます。
          別のスマホやブラウザでも、同じメールアドレスを入れれば同じ成績で遊べます。
        </p>
        {session.kind === "local" && (
          <p className="rounded-2xl border border-dashed border-border px-4 py-3">
            お試しモード：Supabase の接続情報が未設定のため、データはこのブラウザの中だけに保存され、
            <b>同じブラウザの別タブ同士</b>でだけ対戦できます。
          </p>
        )}
        <button type="button" onClick={onFeedback} className="self-start font-bold underline underline-offset-2">
          ご意見・不具合の報告
        </button>
      </div>
    </main>
  );
}
