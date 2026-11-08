# 構成と設計

## 技術スタック

| | 使うもの | 理由 |
|---|---|---|
| 画面 | Next.js 16（App Router）+ React 19 + TypeScript + Tailwind CSS 4 | 画面を1つのプロジェクトで書け、Vercel にそのまま載る |
| DB・通信 | Supabase（PostgreSQL・匿名サインイン・RLS・Realtime） | 自前サーバーなしで、部屋の状態の保存と相手への即時通知ができる |
| 公開 | Vercel | GitHub の main に入ると自動で公開 |
| テスト | Vitest（ルール・通信）、PostgreSQL（RLS・RPC）、Playwright（画面の手動確認） | |

Server Actions や API Route（Route Handler）は使っていない。画面は静的に配信し、ブラウザから Supabase を直接呼ぶ。

## データモデル

`public.rooms`（`supabase/migrations/20261108000000_rooms.sql`）

| 列 | 内容 | 誰が変える |
|---|---|---|
| `id` uuid / `code` 4桁 | 部屋の ID とコード | RPC |
| `host_id` `host_name` / `guest_id` `guest_name` | メンバー（`auth.users` の匿名ユーザー） | RPC |
| `closed` | ホストが退出した | RPC |
| `version` | 更新のたびに +1 | メンバー（トリガーで +1 以外は拒否） |
| `state` jsonb | 準備状態・ルール設定・対戦の進行（`RoomState`） | メンバー |

RPC（`security definer`）: `create_room(p_name)`、`join_room(p_code, p_name)`、`leave_room(p_room_id)`。
RLS は「`auth.uid()` がホストかゲストなら読める・更新できる」。列の権限で、メンバーが直接変えられるのは `state` と `version` だけ。

## 設計のポイント

- **ルールは純粋関数**：`src/lib/domain/game.ts` の `reduce(state, seat, action, ctx)` が「この人がこの操作をしたら次の状態はこう」を返す。できない操作は `null`。乱数とカードは `ctx` で渡すのでテストで固定できる
- **共有の状態 + 楽観的排他**：操作は「今の state に reduce → `version = 今+1` を条件に update」。0件なら相手が先に更新したので、最新を読み直してもう一度 reduce する（`src/lib/room/session.ts`）。画面は送信前に変える（楽観的更新）
- **2人の確認で次へ**：結果画面は `acks` に「次へ」を押した人を入れ、2人そろったら次の問題に進む。どちらかが読んでいる途中で画面が変わらない
- **保存先はインターフェースの裏に**：`RoomClient`（`src/lib/room/types.ts`）に Supabase 版とブラウザ内版（localStorage + BroadcastChannel）がある。環境変数の有無で切り替える（`src/lib/room/client.ts`）
- **古い通知を無視**：Realtime の通知と保存の応答は前後することがあるので、`version` が今より大きいものだけ反映する
- **部屋に戻る**：入っている部屋の ID を localStorage に保存し、起動時に読み直す。匿名ユーザーのセッションも Supabase が localStorage に保存する

## ディレクトリ

```
src/
  app/            layout・page・manifest・icon
  components/     TriviaApp（画面の切り替え）、TitleScreen、LobbyScreen、GameScreen、ui
  data/trivia.json 雑学120問（旧版から引き継ぎ）
  lib/
    domain/game.ts       ルール（純粋関数）とテスト
    room/                RoomClient（Supabase 版・ブラウザ内版）、RoomSession（画面用の状態）
    trivia.ts            雑学データの読み込み
supabase/
  migrations/     DB の定義
  tests/          RLS・RPC のテスト（scripts/test-db.sh で実行）
scripts/          check.sh、test-db.sh
```
