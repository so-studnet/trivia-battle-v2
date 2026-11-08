# 雑学カードバトル v2

本当？ウソ？ 友だちと雑学で対戦する、2人用のオンラインカードゲームです。
[旧版（so-studnet/trivia-battle）](https://github.com/so-studnet/trivia-battle) は Java の自前サーバーで動いていましたが、
v2 では **Next.js + Supabase + Vercel** で作り直し、サーバーの管理なしでスマホからすぐ遊べるようにしました。

## あそびかた

1. 片方が「部屋をつくる」。4桁の部屋コード（または招待リンク）を相手に送る
2. 相手はコードを入れて参加（招待リンクならコードは入力済み）
3. 2人とも「準備OK」にしたら、ホストが「対戦スタート」
4. 出題者は配られた4枚から雑学を1つ選ぶ（出題者には答えが見えている）
5. 回答者は自信度（1〜3点）を賭けて「本当」か「ウソ」かを答える
6. 当たれば回答者に、外れたら出題者に、賭けた点が入る。出題者は毎ターン交代
7. 先に目標点（1〜10、ホストが設定）に届いた人の勝ち

先攻は「ホスト／ゲスト／ランダム」から選べます。雑学は120問（本当60・ウソ60）。

## 旧版からの主な変更

| | 旧版 | v2 |
|---|---|---|
| サーバー | Java（HttpServer）を自分で動かす | なし（Supabase と Vercel） |
| 相手の操作の受け取り | 0.1〜0.5秒ごとに問い合わせ | Supabase Realtime で届いたらすぐ反映 |
| 部屋の状態 | サーバーのメモリ（再起動で消える） | Supabase の DB（再読み込みしても部屋に戻れる） |
| ゲームの進行 | 各端末がそれぞれ計算 | 共有の状態をルールの関数で更新し、version で同時更新を検出 |
| 不正対策 | なし | RLS で部屋のメンバーだけが読み書き可。列の権限で名前などは書き換え不可 |
| その他 | | 招待リンク・共有、スマホ向けデザイン、ダークモード、相手の退出の通知、もう一度あそぶ |

## 開発

```bash
npm install
npm run dev        # http://localhost:3000
```

`.env.local` がなければ「お試しモード」で動き、**同じブラウザの別タブ同士**で対戦できます。
本番と同じように遊ぶには [docs/setup.md](docs/setup.md) の手順で Supabase と Vercel を設定してください。

```bash
npm test           # ルールと通信まわりの単体テスト (Vitest)
npm run test:db    # マイグレーションと RLS のテスト（PostgreSQL 15 以上が必要）
npm run check      # テスト・lint・型チェック・DB テスト・ビルドをまとめて
```

## ドキュメント

- [docs/setup.md](docs/setup.md) — Supabase・Vercel の設定手順
- [docs/requirements.md](docs/requirements.md) — 要件
- [docs/architecture.md](docs/architecture.md) — 構成と設計
- [docs/roadmap.md](docs/roadmap.md) — 進み具合と今後の候補
