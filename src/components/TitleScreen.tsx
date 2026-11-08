"use client";

import { type FormEvent, useEffect, useState } from "react";
import type { RoomSession } from "@/lib/room/session";
import { MAX_NAME_LENGTH, normalizeCode } from "@/lib/room/types";
import { Button, Panel, Spinner } from "./ui";

const NAME_KEY = "trivia-battle:name";

function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function TitleScreen({
  session,
  busy,
  error,
}: {
  session: RoomSession;
  busy: boolean;
  error: string | null;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState<"create" | "join" | null>(null);

  // 保存した名前と、招待リンク（?room=1234）の部屋コードを入れておく
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ブラウザにしかない値を初回に読む
    setName(loadName());
    const fromUrl = new URLSearchParams(window.location.search).get("room");
    if (fromUrl) setCode(normalizeCode(fromUrl).slice(0, 4));
  }, []);

  const trimmed = name.trim();

  const remember = () => {
    try {
      localStorage.setItem(NAME_KEY, trimmed);
    } catch {}
  };

  const create = async () => {
    if (!trimmed) return;
    remember();
    setPending("create");
    await session.createRoom(trimmed);
    setPending(null);
  };

  const join = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!trimmed || code.length !== 4) return;
    remember();
    setPending("join");
    await session.joinRoom(code, trimmed);
    setPending(null);
    // 招待リンクのコードは使い終わったら URL から消す
    if (window.location.search) window.history.replaceState(null, "", window.location.pathname);
  };

  return (
    <main className="flex flex-1 flex-col justify-center gap-6 py-6">
      <header className="animate-fade-up text-center">
        <div className="mb-4 flex justify-center gap-2" aria-hidden>
          <span className="grid h-16 w-12 -rotate-12 place-items-center rounded-xl bg-true text-2xl font-black text-white shadow-lg">
            ◯
          </span>
          <span className="grid h-16 w-12 -translate-y-2 place-items-center rounded-xl bg-primary text-2xl font-black text-white shadow-lg">
            ?
          </span>
          <span className="grid h-16 w-12 rotate-12 place-items-center rounded-xl bg-false text-2xl font-black text-white shadow-lg">
            ✕
          </span>
        </div>
        <h1 className="text-3xl font-black tracking-tight sm:text-4xl">雑学カードバトル</h1>
        <p className="mt-2 text-sm text-muted">本当？ウソ？ 友だちと雑学で対戦しよう</p>
      </header>

      <Panel className="animate-fade-up flex flex-col gap-5">
        <label className="flex flex-col gap-2">
          <span className="text-sm font-bold text-muted">あなたの名前</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={MAX_NAME_LENGTH}
            placeholder="ニックネーム"
            autoComplete="nickname"
            className="h-12 rounded-2xl border-2 border-border bg-surface-2 px-4 text-base font-bold outline-none focus:border-primary"
          />
        </label>

        <Button onClick={create} disabled={!trimmed || busy} className="w-full text-lg">
          {pending === "create" ? <Spinner className="border-white/40 border-t-white" /> : null}
          部屋をつくる
        </Button>

        <div className="flex items-center gap-3 text-xs font-bold text-muted">
          <span className="h-px flex-1 bg-border" />
          または部屋コードで参加
          <span className="h-px flex-1 bg-border" />
        </div>

        <form onSubmit={join} className="flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(normalizeCode(e.target.value).slice(0, 4))}
            inputMode="numeric"
            autoComplete="off"
            placeholder="4桁のコード"
            aria-label="部屋コード"
            className="h-12 min-w-0 flex-1 rounded-2xl border-2 border-border bg-surface-2 px-4 text-center text-xl font-black tracking-[0.4em] outline-none placeholder:text-base placeholder:font-bold placeholder:tracking-normal focus:border-primary"
          />
          <Button type="submit" variant="outline" disabled={!trimmed || code.length !== 4 || busy}>
            {pending === "join" ? <Spinner /> : null}
            参加
          </Button>
        </form>

        {!trimmed && <p className="-mt-2 text-xs text-muted">名前を入れると部屋をつくれます</p>}
        {error && (
          <p role="alert" className="rounded-xl bg-false-soft px-3 py-2 text-sm font-bold text-false">
            {error}
          </p>
        )}
      </Panel>

      {session.kind === "local" && (
        <p className="rounded-2xl border border-dashed border-border px-4 py-3 text-xs leading-relaxed text-muted">
          お試しモード：Supabase の接続情報が未設定のため、
          <b>同じブラウザの別タブ同士</b>でだけ対戦できます。
        </p>
      )}

      <details className="text-sm text-muted">
        <summary className="cursor-pointer font-bold">あそびかた</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 leading-relaxed">
          <li>片方が部屋をつくり、部屋コード（または招待リンク）を相手に送ります。</li>
          <li>2人とも「準備OK」にしたら、ホストが対戦を始めます。</li>
          <li>出題者は配られた4枚から雑学を1つ選びます（出題者には答えが見えています）。</li>
          <li>回答者は自信度（1〜3点）を賭けて「本当」か「ウソ」かを答えます。</li>
          <li>当たれば回答者に、外れたら出題者に、賭けた点が入ります。出題者は毎ターン交代。</li>
          <li>先に目標点に届いた人の勝ち！</li>
        </ol>
      </details>
    </main>
  );
}
