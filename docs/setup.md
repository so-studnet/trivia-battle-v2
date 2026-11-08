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

1. 左のメニューの **SQL Editor** を開き、**New query**
2. GitHub のこのリポジトリの [`supabase/migrations/20261108000000_trivia_battle_rooms.sql`](https://github.com/so-studnet/trivia-battle-v2/blob/main/supabase/migrations/20261108000000_trivia_battle_rooms.sql) を開き、右上の **Copy raw file**（コピーのアイコン）で中身をコピーして貼る
3. 右下の **Run** を押す。`Success. No rows returned` と出れば OK
   - 「destructive operation」の確認が出たら、そのまま実行してよい（中で古い部屋を消す `delete` を使っているため）
4. 左のメニューの **Table Editor** に `trivia_battle_rooms` が出ていることを確かめる

つくられるもの：

| 種類 | 名前 |
|---|---|
| テーブル | `trivia_battle_rooms` |
| 関数 | `trivia_battle_create_room` / `trivia_battle_join_room` / `trivia_battle_get_room` / `trivia_battle_save_state` / `trivia_battle_leave_room` / `trivia_battle_room_json` / `trivia_battle_clean_name` |

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
3. **Environment Variables** を開き、2つ追加する

   | Key | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | 手順3の Project URL |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 手順3の Publishable key |

4. **Deploy**。終わったら表示された URL（`https://<プロジェクト名>.vercel.app`）を開く
5. タイトル画面の下に「お試しモード」の表示が**出ていない**ことを確認。出ている場合は環境変数が入っていないので、**Settings → Environment Variables** を直して **Deployments → 一番上の ⋯ → Redeploy**

以後は `main` に変更が入るたびに自動で公開されます。

## 6. 動作確認

1. スマホで公開 URL を開き、名前を入れて「部屋をつくる」
2. 「招待リンクを送る」で PC（または別のスマホ）に送り、開いて参加
3. 両方で「準備OK！」→ ホストが「対戦スタート」
4. 片方で操作すると、もう片方の画面がすぐ変わることを確認

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
| 「部屋をつくる」で「うまくいきませんでした（…function … does not exist…）」と出る | 手順2の SQL を、Vercel の環境変数と**同じプロジェクト**で実行したか |
| 相手の操作が出るまで10秒ほどかかる | 手順4の Realtime の公開チャンネルの設定。10秒ごとの読み直しで進んでいる状態 |
| 「その部屋コードの部屋は見つかりませんでした」 | コードの打ち間違い。またはホストが部屋を出た（部屋は閉じる） |
| 公開した画面に「お試しモード」と出る | 手順5の環境変数。変えたあとは Redeploy が必要 |
| 別のスマホで続きをしたい | できません。部屋の参加者は端末（ブラウザ）ごとの合言葉で見分けているため、同じ端末・同じブラウザで開き直してください |

## このアプリを Supabase から消したいとき

SQL Editor で次を実行すると、このアプリがつくったものだけが消えます（ほかのアプリには影響しません）。

```sql
drop function if exists public.trivia_battle_create_room(uuid, uuid, text);
drop function if exists public.trivia_battle_join_room(text, uuid, uuid, text);
drop function if exists public.trivia_battle_get_room(uuid, uuid);
drop function if exists public.trivia_battle_save_state(uuid, uuid, integer, jsonb);
drop function if exists public.trivia_battle_leave_room(uuid, uuid);
drop function if exists public.trivia_battle_room_json(public.trivia_battle_rooms);
drop function if exists public.trivia_battle_clean_name(text);
drop table if exists public.trivia_battle_rooms;
```
