"use client";

import { type FormEvent, useEffect, useState } from "react";
import type { RoomSession } from "@/lib/room/session";
import { MAX_NAME_LENGTH, type Player, normalizeCode } from "@/lib/room/types";
import { Avatar, Button, Logo, Panel, Spinner } from "./ui";

export function TitleScreen({
  session,
  player,
  busy,
  error,
  onStats,
  onFeedback,
}: {
  session: RoomSession;
  player: Player;
  busy: boolean;
  error: string | null;
  onStats: () => void;
  onFeedback: () => void;
}) {
  // ログインしているプレイヤーのニックネームを最初から入れておく
  const [name, setName] = useState(player.nickname);
  const [code, setCode] = useState("");
  const [pending, setPending] = useState<"create" | "join" | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // 招待リンク（?room=1234）の部屋コードを入れておく
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("room");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ブラウザにしかない値を初回に読む
    if (fromUrl) setCode(normalizeCode(fromUrl).slice(0, 4));
  }, []);

  const trimmed = name.trim();

  const create = async () => {
    if (!trimmed) return;
    setPending("create");
    await session.createRoom(trimmed);
    setPending(null);
  };

  const join = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!trimmed || code.length !== 4) return;
    setPending("join");
    await session.joinRoom(code, trimmed);
    setPending(null);
    // 招待リンクのコードは使い終わったら URL から消す
    if (window.location.search) window.history.replaceState(null, "", window.location.pathname);
  };

  return (
    <main className="flex flex-1 flex-col gap-6 py-2">
      <div className="relative flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Avatar name={player.nickname} seat="A" />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold">{player.nickname}</p>
            <p className="truncate text-xs text-muted">{player.email}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="outline" className="min-h-10 px-3 text-sm" onClick={onStats}>
            📊 成績
          </Button>
          <Button
            variant="ghost"
            className="min-h-10 px-3 text-lg"
            aria-label="メニュー"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            ⋯
          </Button>
        </div>
        {menuOpen && (
          <div
            role="menu"
            className="animate-fade-up absolute top-12 right-0 z-20 flex w-56 flex-col rounded-2xl border border-border bg-surface p-1 shadow-xl"
          >
            <button
              type="button"
              role="menuitem"
              className="rounded-xl px-3 py-3 text-left text-sm font-bold hover:bg-surface-2"
              onClick={() => {
                setMenuOpen(false);
                onFeedback();
              }}
            >
              ✉️ ご意見・不具合の報告
            </button>
            <button
              type="button"
              role="menuitem"
              className="rounded-xl px-3 py-3 text-left text-sm font-bold text-false hover:bg-surface-2"
              onClick={() => {
                setMenuOpen(false);
                void session.logout();
              }}
            >
              ログアウト
            </button>
          </div>
        )}
      </div>

      <header className="animate-fade-up text-center">
        <Logo />
        <h1 className="text-3xl font-black tracking-tight sm:text-4xl">雑学カードバトル</h1>
        <p className="mt-2 text-sm text-muted">本当？ウソ？ 友だちと雑学で対戦しよう</p>
      </header>

      <Panel className="animate-fade-up flex flex-col gap-5">
        <label className="flex flex-col gap-2">
          <span className="text-sm font-bold text-muted">対戦で使うニックネーム</span>
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
          <li>出題者は手札の4枚から雑学を1つ選びます（出題者には答えが見えています）。</li>
          <li>回答者は自信度（1〜3点）を賭けて「本当」か「ウソ」かを答えます。</li>
          <li>当たれば回答者に、外れたら出題者に、賭けた点が入ります。出題者は毎ターン交代。</li>
          <li>先に目標点に届いた人の勝ち！</li>
        </ol>
        <p className="mt-2 leading-relaxed">
          使わなかった手札は次の出題に持ち越します。一度出会った問題（手札に来た・出題された）は、
          あなたにも相手にも二度と配られません。
        </p>
      </details>
    </main>
  );
}
