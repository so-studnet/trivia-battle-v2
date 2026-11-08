# 雑学カードバトル v2

@AGENTS.md

## ドキュメント

- `docs/requirements.md` 要件 / `docs/architecture.md` 構成 / `docs/roadmap.md` 進み具合 / `docs/setup.md` 利用者向けの設定手順
- 旧版は別リポジトリ `so-studnet/trivia-battle`（ポートフォリオとして残すので変更しない）

## 開発ルール

- ゲームのルールは `src/lib/domain/game.ts` の純粋関数（`reduce`）に置き、Vitest でテストする。画面や通信に書かない
- 画面の文言は日本語。スマホ幅を前提にする
- Supabase のプロジェクトはほかのアプリと共有している。テーブル・関数などの名前は必ず `trivia_battle_` で始め、Auth やプロジェクト全体の設定に頼らない
- DB を変えるときは `supabase/migrations/` に新しいファイルを足す（適用済みのファイルは書き換えない）。RPC と権限のテストを `supabase/tests/` に書く
- 仕様を変えたら docs も更新する

## コミット前

`npm run check`（PostgreSQL がない環境では `SKIP_DB=1 npm run check`）
