"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import type { RoomSession } from "@/lib/room/session";
import { MAX_FEEDBACK_LENGTH } from "@/lib/room/types";
import { Button, Spinner } from "./ui";

/** ご意見・不具合の報告。page が null の間は閉じている */
export function FeedbackDialog({
  session,
  page,
  onClose,
}: {
  session: RoomSession;
  page: string | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState(""); // ボット対策のおとり欄
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (page && !d.open) {
      setState("idle");
      setError(null);
      d.showModal();
    } else if (!page && d.open) {
      d.close();
    }
  }, [page]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const text = message.trim();
    if (!text || state === "sending") return;
    setState("sending");
    setError(null);
    try {
      if (website) throw new Error("送信できませんでした。");
      await session.sendFeedback({ message: text, page: page ?? undefined });
      setMessage("");
      setState("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("idle");
    }
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current?.close()}
      className="m-auto w-[min(32rem,calc(100%-2rem))] rounded-3xl border border-border bg-surface p-0 text-text shadow-2xl backdrop:bg-black/40"
      aria-labelledby="feedback-title"
    >
      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-2">
          <h2 id="feedback-title" className="text-lg font-black">
            ご意見・不具合の報告
          </h2>
          <button type="button" aria-label="閉じる" className="-mt-1 -mr-1 p-2 text-muted" onClick={() => ref.current?.close()}>
            ✕
          </button>
        </div>
        {state === "sent" ? (
          <>
            <p className="rounded-2xl bg-true-soft px-4 py-3 text-sm font-bold text-true" role="status">
              送信しました。ありがとうございます！
            </p>
            <Button onClick={() => ref.current?.close()}>閉じる</Button>
          </>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-3">
            <p className="text-sm text-muted">
              感想、問題の間違い、不具合など、なんでも送ってください。開発者に届きます。
            </p>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={MAX_FEEDBACK_LENGTH}
              rows={5}
              required
              aria-label="内容"
              placeholder="例：〇〇の問題の解説が間違っていると思います"
              className="resize-y rounded-2xl border-2 border-border bg-surface-2 p-3 text-base outline-none focus:border-primary"
            />
            <input
              tabIndex={-1}
              autoComplete="off"
              aria-hidden
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              name="website"
              className="absolute -left-[9999px] h-0 w-0 opacity-0"
            />
            <div className="flex items-center justify-between text-xs text-muted">
              <span>{session.kind === "local" ? "お試しモードでは、このブラウザに保存されるだけです" : ""}</span>
              <span className="shrink-0 whitespace-nowrap tabular-nums">
                {message.length} / {MAX_FEEDBACK_LENGTH}
              </span>
            </div>
            {error && (
              <p role="alert" className="rounded-xl bg-false-soft px-3 py-2 text-sm font-bold text-false">
                {error}
              </p>
            )}
            <Button type="submit" disabled={!message.trim() || state === "sending"}>
              {state === "sending" && <Spinner className="border-white/40 border-t-white" />}
              送信する
            </Button>
          </form>
        )}
      </div>
    </dialog>
  );
}
