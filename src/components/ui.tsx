"use client";
// 小さな共通部品
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "outline" | "ghost" | "true" | "false";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-primary text-on-primary shadow-lg shadow-primary/25 hover:bg-primary-strong active:scale-[0.98]",
  outline: "border-2 border-border bg-surface text-text hover:border-primary active:scale-[0.98]",
  ghost: "text-muted hover:text-text hover:bg-surface-2",
  true: "bg-true text-white shadow-lg shadow-true/25 active:scale-[0.97]",
  false: "bg-false text-white shadow-lg shadow-false/25 active:scale-[0.97]",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-5 font-bold transition disabled:opacity-50 disabled:active:scale-100 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-3xl border border-border bg-surface p-5 shadow-xl shadow-black/5 sm:p-6 ${className}`}>
      {children}
    </div>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block size-5 animate-spin rounded-full border-[3px] border-primary/25 border-t-primary ${className}`}
    />
  );
}

export function Avatar({ name, seat }: { name: string | null; seat: "A" | "B" }) {
  return (
    <span
      className={`grid size-11 shrink-0 place-items-center rounded-2xl text-lg font-black text-white ${
        seat === "A" ? "bg-gradient-to-br from-violet-500 to-indigo-600" : "bg-gradient-to-br from-amber-400 to-orange-500"
      }`}
    >
      {name ? name.slice(0, 1) : "?"}
    </span>
  );
}

/** 本当／ウソのラベル（色だけに頼らず文字でも示す） */
export function TruthBadge({ isTrue, className = "" }: { isTrue: boolean; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${
        isTrue ? "bg-true-soft text-true" : "bg-false-soft text-false"
      } ${className}`}
    >
      {isTrue ? "◯ 本当" : "✕ ウソ"}
    </span>
  );
}

export function TriviaText({ text, large = false }: { text: string; large?: boolean }) {
  return (
    <p className={`font-bold leading-relaxed text-text ${large ? "text-xl sm:text-2xl" : "text-[15px]"}`}>{text}</p>
  );
}

export function Logo() {
  return (
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
  );
}

export function GenreBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-bold text-muted">
      {label}
    </span>
  );
}
