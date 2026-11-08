# 設定手順（Supabase・Vercel）

Supabase と Vercel のダッシュボードは Claude からは操作できないので、この手順で設定してください。
所要時間は 10 分ほどです。

> **秘密の値について**
> Supabase の **Secret key**（`sb_secret_...`）や Database のパスワードは、このアプリでは使いません。
> チャットや GitHub に貼らないでください。
> 使うのは公開してよい値（**Project URL** と **Publishable key** `sb_publishable_...`）だけです。

## 1. Supabase のプロジェクトを選ぶ

無料プランはプロジェクトを2つまでしかつくれないので、**すでにあるプロジェクトに同居させて構いません**。
<https://supabase.com/dashboard> で使うプロジェクトを開きます。

新しくつくる場合は **New project** → Region は **Northeast Asia (Tokyo)**、Database Password は自動生成のままでよい（使わない）。

## 2. テーブルをつくる（SQL を実行）

ほかのアプリと同じプロジェクトに入れて大丈夫です。このアプリが作るものはすべて名前が `trivia_battle_` で始まり、
ほかのアプリのテーブルや設定には触りません（Authentication の設定も変えません）。

`supabase/migrations/` の SQL ファイルを、**ファイル名の順番に、まだ実行していないものだけ**実行します。

| ファイル | 内容 |
|---|---|
| [`20261108000000_trivia_battle_rooms.sql`](https://github.com/so-studnet/trivia-battle-v2/blob/main/supabase/migrations/20261108000000_trivia_battle_rooms.sql) | 対戦部屋 |
| [`20261109000000_trivia_battle_players.sql`](https://github.com/so-studnet/trivia-battle-v2/blob/main/supabase/migrations/20261109000000_trivia_battle_players.sql) | メールでのログイン・出会った問題・成績・フィードバック |
| [`20261110000000_trivia_battle_default_target.sql`](https://github.com/so-studnet/trivia-battle-v2/blob/main/supabase/migrations/20261110000000_trivia_battle_default_target.sql) | 勝利に必要な点数の初期値を10点に |

1. 左のメニューの **SQL Editor** を開き、**New query**
2. GitHub で SQL ファイルを開き、右上の **Copy raw file**（コピーのアイコン）で中身をコピーして貼る
3. 右下の **Run** を押す。`Success. No rows returned` と出れば OK
   - 「destructive operation」の確認が出たら、そのまま実行してよい（古い部屋を消す `delete` などを使っているため）
4. 次のファイルも同じように実行する
5. 左のメニューの **Table Editor** に `trivia_battle_` で始まるテーブルが出ていることを確かめる

> **アプリを更新するとき（2回目以降）の順番**
> 新しい SQL ファイルが増えたときは、**SQL を実行してから**アプリ（PR）をマージしてください。
> SQL を実行してからマージするまでの数分間は、公開中のアプリで部屋をつくれなくなります（進行中の部屋も消えます）。
> 友だちと遊んでいない時間にまとめて行うのがおすすめです。

つくられるテーブル：

| テーブル | 内容 |
|---|---|
| `trivia_battle_players` | プレイヤー（メールアドレス・ニックネーム・持ち越しの手札） |
| `trivia_battle_sessions` | ログイン中の端末 |
| `trivia_battle_rooms` | 対戦部屋 |
| `trivia_battle_seen` | プレイヤーが出会った問題 |
| `trivia_battle_answers` | 1問ごとの記録 |
| `trivia_battle_games` | 終わった対戦 |
| `trivia_battle_feedback` | 届いたフィードバック（メールが届かなかったときもここで読める） |

## 3. 接続情報を確かめる

すでにほかのアプリで使っている値と同じです。

- **Project URL**：`https://<プロジェクトID>.supabase.co`。プロジェクトID はダッシュボードの URL の `project/<ID>/` の部分。画面上部の緑の **Connect** ボタンからも見られる
- **Publishable key**：左下の **Project Settings** → **API Keys** にある `sb_publishable_...`。右のコピーボタンでコピー
  - 同じ画面の **Secret keys** は使いません

## 4. Realtime の設定を確かめる（通常はそのままで OK）

相手への通知に Realtime の Broadcast（公開チャンネル）を使います。

- 左のメニューの **Realtime** → **Settings** に「**Allow public access**」（または「Private channels only」）の項目があれば、
  公開チャンネルが**許可されている**状態（Allow public access がオン／Private channels only がオフ）にする
- 新しいプロジェクトは最初から許可されています

> 許可されていなくてもゲームは進みますが、相手の操作が画面に出るまで最大10秒ほどかかります。

## 5. Vercel で公開する

前提：このリポジトリの `main` ブランチにアプリのコードが入っていること（PR をマージ済み）。

> **先に GitHub の既定ブランチを `main` にする**
> このリポジトリは最初に作業ブランチが push されたため、既定ブランチが `claude/...` になっています。
> GitHub のリポジトリの **Settings** → **General** → **Default branch** の ⇄ ボタンで `main` を選んで **Update**。
> （Vercel は既定ブランチを本番として公開します。あとから変える場合は Vercel の **Settings → Git → Production Branch**）

1. <https://vercel.com/new> を開き、**Import Git Repository** で `trivia-battle-v2` の **Import**
2. **Application Preset** が **Next.js** になっていることを確認（Other なら Next.js を選ぶ）。Root Directory は `./` のまま
3. **Environment Variables** を開き、2つ追加する（フィードバックのメール用の変数は手順7で追加）

   | Key | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | 手順3の Project URL |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 手順3の Publishable key |

4. **Deploy**。終わったら表示された URL（`https://<プロジェクト名>.vercel.app`）を開く
5. タイトル画面の下に「お試しモード」の表示が**出ていない**ことを確認。出ている場合は環境変数が入っていないので、**Settings → Environment Variables** を直して **Deployments → 一番上の ⋯ → Redeploy**

以後は `main` に変更が入るたびに自動で公開されます。

## 6. 動作確認

1. スマホで公開 URL を開き、メールアドレスを入れて「次へ」→ ニックネームを決めて「登録してはじめる」
2. 「部屋をつくる」→「招待リンクを送る」で PC（または別のスマホ）に送り、開いて（ログインして）参加
3. 両方で「準備OK！」→ ホストが「対戦スタート」
4. 片方で操作すると、もう片方の画面がすぐ変わることを確認
5. 対戦が終わったら、タイトル画面の「📊 成績」に記録が出ることを確認

## 7. フィードバックをメールで受け取る（Resend）

アプリの「ご意見・不具合の報告」から送られた内容を、メールで受け取るための設定です。
設定しなくてもフィードバックは Supabase の `trivia_battle_feedback` テーブルに保存されます（Table Editor で読めます）。

1. <https://resend.com/signup> で、**フィードバックを受け取りたいメールアドレス**でアカウントをつくる
   - 独自ドメインを持っていない場合、Resend の送信用アドレス（`onboarding@resend.dev`）からは**アカウントのメールアドレスにしか送れません**。必ず受け取りたいアドレスで登録してください
2. Resend の左のメニューの **API Keys** →「**Create API Key**」。Name は `trivia-battle` など、Permission は **Sending access** で **Add**
3. 表示された `re_...` で始まるキーをコピーする（この画面でしか表示されません）
   - **このキーは秘密の値です。** チャットや GitHub には貼らず、次の Vercel の画面にだけ貼ってください
4. Vercel のプロジェクトの **Settings → Environment Variables** で2つ追加する（`NEXT_PUBLIC_` は付けない）

   | Key | Value | Sensitive |
   |---|---|---|
   | `RESEND_API_KEY` | 手順3のキー | オン |
   | `FEEDBACK_TO_EMAIL` | 手順1で登録したメールアドレス | オフでよい |

5. **Deployments → 一番上の ⋯ → Redeploy**
6. 公開したアプリの「⋯」→「ご意見・不具合の報告」から試しに送って、メールが届くことを確認（迷惑メールフォルダも見る）

> 届け先のメールアドレスは、公開されるコード（GitHub）には書かず、Vercel の環境変数だけに入れています。

## 手元の PC で動かす（Windows / PowerShell）

```powershell
cd trivia-battle-v2
npm install
Copy-Item .env.example .env.local
notepad .env.local   # 2つの値を書き換えて保存
npm run dev
```

ブラウザで <http://localhost:3000> を開きます。`.env.local` がなければ「お試しモード」で動き、同じブラウザの別タブ同士で対戦できます。
`.env.local` は `.gitignore` に入っているので GitHub には上がりません。

## 困ったとき

| 症状 | 確かめること |
|---|---|
| 「うまくいきませんでした（…function … does not exist…）」と出る | 手順2の SQL を**すべて**、Vercel の環境変数と**同じプロジェクト**で実行したか |
| 相手の操作が出るまで10秒ほどかかる | 手順4の Realtime の公開チャンネルの設定。10秒ごとの読み直しで進んでいる状態 |
| 「その部屋コードの部屋は見つかりませんでした」 | コードの打ち間違い。またはホストが部屋を出た（部屋は閉じる） |
| 公開した画面に「お試しモード」と出る | 手順5の環境変数。変えたあとは Redeploy が必要 |
| フィードバックのメールが届かない | 手順7の環境変数と Redeploy。`FEEDBACK_TO_EMAIL` が Resend に登録したアドレスと同じか。Vercel の **Logs** に `feedback mail failed` と出ていれば、その内容を見る。内容は `trivia_battle_feedback` テーブルには保存されている |
| 別のスマホで続きをしたい | 同じメールアドレスでログインすれば、成績は引き継がれ、対戦中の部屋にも部屋コードで戻れます |
| 他人のメールアドレスでログインされないか心配 | このアプリは確認メールを送らないため、メールアドレスを知っていればその人としてログインできます。大事な情報は入れないでください |

## このアプリを Supabase から消したいとき

SQL Editor で次を実行すると、このアプリがつくったもの（`trivia_battle_` で始まるテーブルと関数）だけが消えます。ほかのアプリには影響しません。

```sql
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'trivia\_battle\_%'
  loop
    execute 'drop function ' || f.sig || ' cascade';
  end loop;
end $$;
drop table if exists public.trivia_battle_feedback, public.trivia_battle_answers, public.trivia_battle_games,
  public.trivia_battle_seen, public.trivia_battle_sessions, public.trivia_battle_rooms, public.trivia_battle_players cascade;
```
