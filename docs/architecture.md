# 構成と設計

## 技術スタック

| | 使うもの | 理由 |
|---|---|---|
| 画面 | Next.js 16（App Router）+ React 19 + TypeScript + Tailwind CSS 4 | 画面を1つのプロジェクトで書け、Vercel にそのまま載る |
| DB・通信 | Supabase（PostgreSQL の RPC・Realtime Broadcast） | 自前サーバーなしで、部屋の状態の保存と相手への即時通知ができる。Auth は使わない（同じプロジェクトのほかのアプリと同居するため） |
| 公開 | Vercel | GitHub の main に入ると自動で公開 |
| テスト | Vitest（ルール・通信）、PostgreSQL（RLS・RPC）、Playwright（画面の手動確認） | |

Server Actions や API Route（Route Handler）は使っていない。画面は静的に配信し、ブラウザから Supabase を直接呼ぶ。

## データモデル

`public.trivia_battle_rooms`（`supabase/migrations/20261108000000_trivia_battle_rooms.sql`）

| 列 | 内容 |
|---|---|
| `id` uuid / `code` 4桁 | 部屋の ID とコード |
| `host_player_id` `host_token` `host_name` / `guest_*` | メンバー。player_id は相手にも見える ID、token は本人だけが知る合言葉 |
| `closed` | ホストが退出した |
| `version` | 更新のたびに +1 |
| `state` jsonb | 準備状態・ルール設定・対戦の進行（`RoomState`） |

テーブルは RLS 有効・ポリシーなし・anon / authenticated の権限なしで、**直接は誰も読み書きできない**。
操作はすべて `security definer` の RPC で、token で本人確認する（返す JSON に token は含めない）。

| RPC | 内容 |
|---|---|
| `trivia_battle_create_room(player_id, token, name)` | 部屋をつくる（閉じた部屋・12時間動きのない部屋を片付ける） |
| `trivia_battle_join_room(code, player_id, token, name)` | 参加。同じ token ならそのまま返す |
| `trivia_battle_get_room(room_id, token)` | 読む。メンバーでなければ null |
| `trivia_battle_save_state(room_id, token, version, state)` | version が一致したときだけ保存。ずれていたら null |
| `trivia_battle_leave_room(room_id, token)` | ホストなら部屋を閉じ、ゲストなら席を空ける |

### ほかのアプリとの同居

Supabase の無料枠はプロジェクトが2つまでなので、1つのプロジェクトに複数のアプリを入れる前提にしている。

- テーブル・関数の名前はすべて `trivia_battle_` で始める
- Supabase Auth を使わない。匿名サインインを有効にするとプロジェクト全体に効き、ほかのアプリに匿名ユーザーが入れるようになるため
- Realtime は Broadcast だけを使い、`supabase_realtime` publication には追加しない
- アプリ側の localStorage のキーも `trivia-battle:` で始める

## 設計のポイント

- **ルールは純粋関数**：`src/lib/domain/game.ts` の `reduce(state, seat, action, ctx)` が「この人がこの操作をしたら次の状態はこう」を返す。できない操作は `null`。乱数とカードは `ctx` で渡すのでテストで固定できる
- **共有の状態 + 楽観的排他**：操作は「今の state に reduce → 今の version を付けて `save_state`」。null なら相手が先に更新したので、最新を読み直してもう一度 reduce する（`src/lib/room/session.ts`）。画面は送信前に変える（楽観的更新）
- **通知は「変わったよ」だけ**：保存・退出のあと、Realtime Broadcast のチャンネル `trivia-battle:room:<id>` に `changed` を送る。受け取った側は `get_room` で読み直す（中身は送らないので、チャンネルを覗かれても部屋の内容は漏れない）。つながったときにも1回送り、参加の知らせを兼ねる
- **2人の確認で次へ**：結果画面は `acks` に「次へ」を押した人を入れ、2人そろったら次の問題に進む。どちらかが読んでいる途中で画面が変わらない
- **保存先はインターフェースの裏に**：`RoomClient`（`src/lib/room/types.ts`）に Supabase 版とブラウザ内版（localStorage + BroadcastChannel）がある。環境変数の有無で切り替える（`src/lib/room/client.ts`）
- **古い通知を無視**：Realtime の通知と保存の応答は前後することがあるので、`version` が今より大きいものだけ反映する
- **部屋に戻る**：入っている部屋の ID と、端末のプレイヤー（player_id・token）を localStorage に保存し、起動時に読み直す

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
