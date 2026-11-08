# 構成と設計

## 技術スタック

| | 使うもの | 理由 |
|---|---|---|
| 画面 | Next.js 16（App Router）+ React 19 + TypeScript + Tailwind CSS 4 | 画面を1つのプロジェクトで書け、Vercel にそのまま載る |
| DB・通信 | Supabase（PostgreSQL の RPC・Realtime Broadcast） | 自前サーバーなしで、部屋の状態の保存と相手への即時通知ができる。Auth は使わない（同じプロジェクトのほかのアプリと同居するため） |
| 公開 | Vercel | GitHub の main に入ると自動で公開 |
| テスト | Vitest（ルール・通信）、PostgreSQL（RLS・RPC）、Playwright（画面の手動確認） | |

画面は静的に配信し、ブラウザから Supabase の RPC を直接呼ぶ。サーバー側の処理はフィードバックのメール送信（`/api/feedback`）だけ。

## データモデル

マイグレーション：`supabase/migrations/20261108000000_trivia_battle_rooms.sql`（部屋）→ `20261109000000_trivia_battle_players.sql`（ログイン・記録・フィードバック）

| テーブル | 内容 |
|---|---|
| `trivia_battle_players` | プレイヤー。`email`（小文字・一意）、`nickname`、`saved_hand`（持ち越しの手札） |
| `trivia_battle_sessions` | ログイン中の端末。`token`（uuid）→ `player_id` |
| `trivia_battle_rooms` | 部屋。`host_player_id` / `guest_player_id` と名前、`closed`、`version`、`state` jsonb（`RoomState`） |
| `trivia_battle_seen` | プレイヤーが出会った問題（`player_id`, `card_id`, 最初と最後に出会った時刻） |
| `trivia_battle_answers` | 1問ごとの記録（`game_id`+`round` が主キー。出題者・回答者・正誤・賭け点） |
| `trivia_battle_games` | 終わった対戦（勝者・スコア・その時点の名前） |
| `trivia_battle_feedback` | フィードバック |

テーブルはすべて RLS 有効・ポリシーなし・anon / authenticated の権限なしで、**直接は誰も読み書きできない**。
操作はすべて `security definer` の RPC で、ログインで発行したセッション token から本人を調べる。

| RPC | 内容 |
|---|---|
| `trivia_battle_login(email)` | 登録済みならセッションを発行。未登録なら `{"status":"new"}` |
| `trivia_battle_register(email, nickname)` | 登録してセッションを発行（登録済みならそのままログイン） |
| `trivia_battle_me(token)` / `trivia_battle_logout(token)` | ログイン状態の確認 / ログアウト |
| `trivia_battle_create_room(token, name)` | 部屋をつくる（ニックネームも更新。閉じた部屋・12時間動きのない部屋を片付ける） |
| `trivia_battle_join_room(code, token, name)` | 参加。すでにメンバーならそのまま返す |
| `trivia_battle_get_room(room_id, token)` | 読む。メンバーでなければ null |
| `trivia_battle_save_state(room_id, token, version, state)` | version が一致したときだけ保存。ずれていたら null。保存したら `trivia_battle_record` で記録をつける |
| `trivia_battle_leave_room(room_id, token)` | ホストなら部屋を閉じ、ゲストなら席を空ける |
| `trivia_battle_deal_info(room_id, token)` | 対戦開始用：2人が出会った問題（最後に出会った時刻）と、持ち越しの手札（相手が出会ったものは除く） |
| `trivia_battle_my_stats(token)` | 自分の1問ごとの記録・終わった対戦・出会った問題の数 |
| `trivia_battle_save_feedback(token, message, page)` | フィードバックを保存（送りすぎは断る） |

**記録のつけ方**：`save_state` のたびに、保存した `state.game` から「手札に配られた問題」「出題された問題」「1問ごとの記録」「終わった対戦と持ち越しの手札」を、何度呼ばれても同じ結果になるように書き込む（`trivia_battle_record`）。記録に失敗しても対戦は止めない。
集計（正答率など）はブラウザで行う（`src/lib/domain/stats.ts`）。ジャンルなどの問題の情報はアプリの中（`src/data/trivia.json`）にあるため。

**フィードバック**：`/api/feedback`（Route Handler）が RPC で保存し、Resend の API でメールを送る。API キー（`RESEND_API_KEY`）と届け先（`FEEDBACK_TO_EMAIL`）はサーバー側の環境変数だけに置き、ブラウザには出さない。

### ほかのアプリとの同居

Supabase の無料枠はプロジェクトが2つまでなので、1つのプロジェクトに複数のアプリを入れる前提にしている。

- テーブル・関数の名前はすべて `trivia_battle_` で始める
- Supabase Auth を使わない。Auth の設定（匿名サインイン・新規登録の可否など）はプロジェクト全体に効き、ほかのアプリに影響するため。メールでのログインもアプリ独自のテーブルで行う
- Realtime は Broadcast だけを使い、`supabase_realtime` publication には追加しない
- アプリ側の localStorage のキーも `trivia-battle:` で始める

## 設計のポイント

- **ルールは純粋関数**：`src/lib/domain/game.ts` の `reduce(state, seat, action, ctx)` が「この人がこの操作をしたら次の状態はこう」を返す。できない操作は `null`。乱数とカードは `ctx` で渡すのでテストで固定できる
- **共有の状態 + 楽観的排他**：操作は「今の state に reduce → 今の version を付けて `save_state`」。null なら相手が先に更新したので、最新を読み直してもう一度 reduce する（`src/lib/room/session.ts`）。画面は送信前に変える（楽観的更新）
- **通知は「変わったよ」だけ**：保存・退出のあと、Realtime Broadcast のチャンネル `trivia-battle:room:<id>` に `changed` を送る。受け取った側は `get_room` で読み直す（中身は送らないので、チャンネルを覗かれても部屋の内容は漏れない）。つながったときにも1回送り、参加の知らせを兼ねる
- **2人の確認で次へ**：結果画面は `acks` に「次へ」を押した人を入れ、2人そろったら次の問題に進む。どちらかが読んでいる途中で画面が変わらない
- **保存先はインターフェースの裏に**：`RoomClient`（`src/lib/room/types.ts`）に Supabase 版とブラウザ内版（localStorage + BroadcastChannel）がある。環境変数の有無で切り替える（`src/lib/room/client.ts`）
- **古い通知を無視**：Realtime の通知と保存の応答は前後することがあるので、`version` が今より大きいものだけ反映する
- **部屋に戻る**：入っている部屋の ID とセッション token を localStorage に保存し、起動時に読み直す（お試しモードではタブごとに別のプレイヤーにするため sessionStorage）
- **出会った問題と手札の持ち越し**（`refillHand`）：対戦開始時に `deal_info` で2人の「出会った問題」と持ち越しの手札を受け取り、`state.game.seenAt` に入れる。補充はまず2人とも出会っていない問題からジャンルがばらけるように、なければこの対戦より前に出会った問題を古い順に選ぶ。出題しなかったカードは手札に残るので、2回目以降の出題では1枚だけ補充すればよい

## ディレクトリ

```
src/
  app/            layout・page・manifest・icon、api/feedback（フィードバックの受け付け）
  components/     TriviaApp（画面の切り替え）、LoginScreen、TitleScreen、LobbyScreen、GameScreen、StatsScreen、FeedbackDialog、ui
  data/trivia.json 雑学300問（旧版の120問 + 追加180問、8ジャンル）
  lib/
    domain/game.ts       ルール（純粋関数）とテスト。出会った問題・手札の持ち越しを含む
    domain/stats.ts      成績の集計
    feedback.ts          フィードバックの受け付け・メールの組み立て（サーバー側）
    room/                RoomClient（Supabase 版・ブラウザ内版）、RoomSession（ログイン・部屋の状態）
    trivia.ts            雑学データの読み込み
supabase/
  migrations/     DB の定義
  tests/          RLS・RPC のテスト（scripts/test-db.sh で実行）
scripts/          check.sh、test-db.sh
```
