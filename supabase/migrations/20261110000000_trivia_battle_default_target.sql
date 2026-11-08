-- 雑学カードバトル v2: 新しい部屋の「勝利に必要な点数」の初期値を 3 点から 10 点にする
-- （すでにある部屋の設定は変えない）
alter table public.trivia_battle_rooms
  alter column state set default
    '{"ready":{"A":false,"B":false},"settings":{"firstPlayer":"random","targetScore":10},"game":null}'::jsonb;
