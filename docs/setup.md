# 設定手順（Supabase・Vercel）

Supabase と Vercel のダッシュボードは Claude からは操作できないので、この手順で設定してください。
所要時間は 15 分ほどです。

> **秘密の値について**
> Supabase の **Secret key**（`sb_secret_...`）や Database のパスワードは、このアプリでは使いません。
> チャットや GitHub に貼らないでください。
> 使うのは公開してよい値（**Project URL** と **Publishable key** `sb_publishable_...`）だけです。

## 1. Supabase のプロジェクトをつくる

1. <https://supabase.com/dashboard> を開き、**New project**
2. Name は `trivia-battle-v2` など。Region は **Northeast Asia (Tokyo)**。Database Password は自動生成のままでよい（使わない）
3. **Create new project** を押して、準備ができるまで1〜2分待つ

## 2. テーブルをつくる（SQL を実行）

1. 左のメニューの **SQL Editor** を開く
2. GitHub のこのリポジトリの `supabase/migrations/20261108000000_rooms.sql` を開き、中身をすべてコピーして貼る
3. 右下の **Run** を押す。`Success. No rows returned` と出れば OK
4. 左のメニューの **Table Editor** に `rooms` が出ていることを確かめる

## 3. 匿名サインインを有効にする

このアプリは利用者に会員登録させず、裏で匿名ユーザーをつくって使います。

1. 左のメニューの **Authentication** → **Sign In / Providers**（画面によっては **Settings**）
2. **Allow anonymous sign-ins** をオンにして **Save**

> オフのままだと、アプリで「部屋をつくる」を押したときに「サーバーに接続できませんでした（匿名ログインに失敗）」と出ます。

## 4. 接続情報を確かめる

- **Project URL**：`https://<プロジェクトID>.supabase.co`。プロジェクトID はダッシュボードの URL の `project/<ID>/` の部分。画面上部の緑の **Connect** ボタンからも見られる
- **Publishable key**：左下の **Project Settings** → **API Keys** にある `sb_publishable_...`。右のコピーボタンでコピー
  - 同じ画面の **Secret keys** は使いません

## 5. Vercel で公開する

前提：このリポジトリの `main` ブランチにアプリのコードが入っていること（作業ブランチの PR をマージ済み）。
`main` が空のままだと Vercel の Application Preset が「Other」になり、うまく公開されません。

1. <https://vercel.com/new> を開き、**Import Git Repository** で `trivia-battle-v2` の **Import**
2. **Application Preset** が **Next.js** になっていることを確認（Other なら Next.js を選ぶ）。Root Directory は `./` のまま
3. **Environment Variables** を開き、2つ追加する

   | Key | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | 手順4の Project URL |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 手順4の Publishable key |

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
| 「匿名ログインに失敗」と出る | 手順3の Allow anonymous sign-ins がオンか |
| 部屋はできるが、相手が参加しても画面が変わらない | 手順2の SQL を最後まで実行したか（最後の `alter publication supabase_realtime add table public.rooms;`）。15秒待つか画面を切り替えると読み直すので、それで変わるなら Realtime だけが届いていない |
| 「その部屋コードの部屋は見つかりませんでした」 | コードの打ち間違い。またはホストが部屋を出た（部屋は閉じる） |
| 公開した画面に「お試しモード」と出る | 手順5の環境変数。変えたあとは Redeploy が必要 |
| 匿名ユーザーがたまってきた | Authentication → Users で古いものを消してよい（消すとその人がつくった部屋も消える） |
