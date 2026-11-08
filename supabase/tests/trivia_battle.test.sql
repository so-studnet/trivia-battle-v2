-- ログイン・部屋・記録・成績・フィードバックの RPC と権限のテスト。失敗すると例外で止まる。
-- アプリはログインなし（anon ロール）で RPC を呼ぶ。
\set ON_ERROR_STOP on

create temp table v (k text primary key, val text);
grant all on v to anon, authenticated;
create function pg_temp.g(k text) returns text language sql as $$ select val from v where v.k = $1 $$;
create function pg_temp.tok(k text) returns uuid language sql as $$ select val::uuid from v where v.k = $1 $$;

set role anon;

-- ===== ログイン =====
do $$ declare j jsonb; begin
  j := public.trivia_battle_login('  Alice@Example.COM ');
  assert j->>'status' = 'new', '未登録なら new';
  j := public.trivia_battle_register('alice@example.com', ' アリス ');
  assert j->>'status' = 'ok' and j->'player'->>'nickname' = 'アリス', '登録してログイン';
  assert j->'player'->>'email' = 'alice@example.com', 'メールは小文字にそろえる';
  insert into v values ('a_tok', j->>'token'), ('a_id', j->'player'->>'id');
  -- 同じアドレスでもう一度ログインすると、別のセッションができる（別の端末）
  j := public.trivia_battle_login('ALICE@example.com');
  assert j->>'status' = 'ok' and j->'player'->>'id' = pg_temp.g('a_id'), '大文字でもログインできる';
  insert into v values ('a_tok2', j->>'token');
  assert pg_temp.g('a_tok2') <> pg_temp.g('a_tok'), '端末ごとに別の token';
  -- 登録済みのアドレスで register しても、二重には作られない
  j := public.trivia_battle_register('alice@example.com', '別名');
  assert j->'player'->>'id' = pg_temp.g('a_id') and j->'player'->>'nickname' = 'アリス', '登録済みならそのままログイン';
  insert into v values ('b_tok', public.trivia_battle_register('bob@example.com', 'ボブ')->>'token');
  insert into v values ('c_tok', public.trivia_battle_register('carol@example.com', 'キャロル')->>'token');
  -- me / logout
  assert public.trivia_battle_me(pg_temp.tok('a_tok'))->>'nickname' = 'アリス', 'me で自分がわかる';
  assert public.trivia_battle_me(gen_random_uuid()) is null, '知らない token は null';
  perform public.trivia_battle_logout(pg_temp.tok('a_tok2'));
  assert public.trivia_battle_me(pg_temp.tok('a_tok2')) is null, 'ログアウトした token は使えない';
  assert public.trivia_battle_me(pg_temp.tok('a_tok')) is not null, 'ほかの端末はログインしたまま';
end $$;

do $$ begin
  begin
    perform public.trivia_battle_login('not-an-email');
    raise exception 'FAIL: 形式違いのメールが通った';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.trivia_battle_register('x@example.com', '');
    raise exception 'FAIL: 空のニックネームで登録できた';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.trivia_battle_create_room(gen_random_uuid(), 'x');
    raise exception 'FAIL: ログインせずに部屋をつくれた';
  exception when invalid_authorization_specification then null;
  end;
end $$;

-- テーブルは直接読めない。内部用の関数も呼べない
do $$ begin
  begin
    perform count(*) from public.trivia_battle_players;
    raise exception 'FAIL: players を直接読めた';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from public.trivia_battle_sessions;
    raise exception 'FAIL: sessions を直接読めた';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from public.trivia_battle_rooms;
    raise exception 'FAIL: rooms を直接読めた';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.trivia_battle_player_of(gen_random_uuid());
    raise exception 'FAIL: 内部用の関数を呼べた';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ===== 部屋 =====
do $$ declare j jsonb; begin
  j := public.trivia_battle_create_room(pg_temp.tok('a_tok'), 'あり');
  insert into v values ('room', j->>'id'), ('code', j->>'code');
  assert j->>'host_id' = pg_temp.g('a_id') and j->>'host_name' = 'あり', 'ホストになる';
  assert public.trivia_battle_me(pg_temp.tok('a_tok'))->>'nickname' = 'あり', 'ニックネームが更新される';
  j := public.trivia_battle_join_room(pg_temp.g('code'), pg_temp.tok('b_tok'), 'ボブ');
  assert (j->>'version')::int = 2 and j->>'guest_name' = 'ボブ', 'ゲストとして入る';
  begin
    perform public.trivia_battle_join_room(pg_temp.g('code'), pg_temp.tok('c_tok'), 'キャロル');
    raise exception 'FAIL: 満員の部屋に入れた';
  exception when unique_violation then null;
  end;
  assert public.trivia_battle_get_room(pg_temp.g('room')::uuid, pg_temp.tok('c_tok')) is null, '部外者は読めない';
  assert public.trivia_battle_get_room(pg_temp.g('room')::uuid, pg_temp.tok('b_tok')) is not null, 'ゲストは読める';
  -- 同じ人が別の端末でログインしても、同じ部屋に入れる
  j := public.trivia_battle_login('bob@example.com');
  insert into v values ('b_tok2', j->>'token');
  assert public.trivia_battle_get_room(pg_temp.g('room')::uuid, pg_temp.tok('b_tok2')) is not null, '別の端末からも読める';
  begin
    perform public.trivia_battle_save_state(pg_temp.g('room')::uuid, pg_temp.tok('c_tok'), 2, '{}');
    raise exception 'FAIL: 部外者が保存できた';
  exception when insufficient_privilege then null;
  end;
  assert public.trivia_battle_save_state(pg_temp.g('room')::uuid, pg_temp.tok('a_tok'), 1, '{}') is null, '古い version は保存しない';
end $$;

-- ===== 対戦の記録 =====
-- 新しい2人なので、出会った問題はまだない
do $$ declare j jsonb; begin
  j := public.trivia_battle_deal_info(pg_temp.g('room')::uuid, pg_temp.tok('a_tok'));
  assert j->'seenAt' = '{}'::jsonb, 'まだ出会った問題はない';
  assert j->'hands' = '{"A":[],"B":[]}'::jsonb, '持ち越しの手札もない';
end $$;

-- 1問目: A が 1〜4 を配られ 1 を出題、B が正解（2点）
do $$ declare j jsonb; begin
  j := public.trivia_battle_save_state(pg_temp.g('room')::uuid, pg_temp.tok('a_tok'), 2, '{
    "ready":{"A":true,"B":true},"settings":{"firstPlayer":"A","targetScore":3},
    "game":{"id":"11111111-1111-4111-8111-111111111111","phase":"select","questioner":"A",
      "hands":{"A":[1,2,3,4],"B":[]},"history":[],"scores":{"A":0,"B":0},"winner":null}}');
  assert (j->>'version')::int = 3, '保存できる';
  j := public.trivia_battle_save_state(pg_temp.g('room')::uuid, pg_temp.tok('b_tok'), 3, '{
    "ready":{"A":true,"B":true},"settings":{"firstPlayer":"A","targetScore":3},
    "game":{"id":"11111111-1111-4111-8111-111111111111","phase":"result","questioner":"A",
      "hands":{"A":[2,3,4],"B":[]},"scores":{"A":0,"B":2},"winner":null,
      "history":[{"round":1,"cardId":1,"questioner":"A","guess":true,"bet":2,"correct":true,"scorer":"B"}]}}');
  -- 同じ状態をもう一度保存しても（再送）、記録は二重にならない
  j := public.trivia_battle_save_state(pg_temp.g('room')::uuid, pg_temp.tok('b_tok'), 4, j->'state');
  -- 2問目: B が 5〜8 を配られ 5 を出題、A が不正解（1点）→ B が 3点で勝ち
  j := public.trivia_battle_save_state(pg_temp.g('room')::uuid, pg_temp.tok('a_tok'), 5, '{
    "ready":{"A":true,"B":true},"settings":{"firstPlayer":"A","targetScore":3},
    "game":{"id":"11111111-1111-4111-8111-111111111111","phase":"over","questioner":"B",
      "hands":{"A":[2,3,4],"B":[6,7,8]},"scores":{"A":0,"B":3},"winner":"B",
      "history":[{"round":1,"cardId":1,"questioner":"A","guess":true,"bet":2,"correct":true,"scorer":"B"},
                 {"round":2,"cardId":5,"questioner":"B","guess":true,"bet":1,"correct":false,"scorer":"B"}]}}');
  assert (j->>'version')::int = 6, '最後まで保存できる';
end $$;

-- 成績
do $$ declare s jsonb; begin
  s := public.trivia_battle_my_stats(pg_temp.tok('a_tok'));
  assert jsonb_array_length(s->'answers') = 2, 'A の記録は2問（出題1・回答1）';
  assert s->'answers'->0->>'role' = 'questioner' and (s->'answers'->0->>'correct')::boolean, '1問目は出題（相手が正解）';
  assert s->'answers'->1->>'role' = 'guesser' and not (s->'answers'->1->>'correct')::boolean, '2問目は回答（不正解）';
  assert jsonb_array_length(s->'games') = 1, '対戦は1回';
  assert not (s->'games'->0->>'won')::boolean and s->'games'->0->>'opponentName' = 'ボブ', '負け・相手はボブ';
  assert (s->'games'->0->>'myScore')::int = 0 and (s->'games'->0->>'opponentScore')::int = 3, 'スコア';
  -- A が出会ったのは 1,2,3,4（手札）と 5（出題された）
  assert (s->>'seenCount')::int = 5, 'A が出会った問題は5つ';
  s := public.trivia_battle_my_stats(pg_temp.tok('b_tok2'));
  assert (s->'games'->0->>'won')::boolean, 'B は勝ち（別の端末から見ても同じ）';
  -- B が出会ったのは 1（出題された）と 5,6,7,8（手札）
  assert (s->>'seenCount')::int = 5, 'B が出会った問題は5つ';
end $$;

-- 部外者は成績を見られない
do $$ begin
  begin
    perform public.trivia_battle_my_stats(gen_random_uuid());
    raise exception 'FAIL: ログインせずに成績を見られた';
  exception when invalid_authorization_specification then null;
  end;
  begin
    perform public.trivia_battle_deal_info(pg_temp.g('room')::uuid, pg_temp.tok('c_tok'));
    raise exception 'FAIL: 部外者が出会った問題を見られた';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 次の対戦の配り方: 出会った問題と、持ち越しの手札
do $$ declare j jsonb; begin
  j := public.trivia_battle_deal_info(pg_temp.g('room')::uuid, pg_temp.tok('b_tok'));
  assert (select count(*) from jsonb_object_keys(j->'seenAt')) = 8, '2人が出会った問題は 1〜8';
  assert j->'hands'->'A' = '[2,3,4]'::jsonb, 'A は前の手札を持ち越す';
  assert j->'hands'->'B' = '[6,7,8]'::jsonb, 'B も持ち越す';
end $$;

-- 相手が変わったら、新しい相手がすでに出会った問題は持ち越さない
do $$ declare j jsonb; begin
  -- C が B と同じ問題 6 に出会っている状態をつくる（C の部屋で C が 6 を配られる）
  j := public.trivia_battle_create_room(pg_temp.tok('c_tok'), 'キャロル');
  insert into v values ('room2', j->>'id');
  perform public.trivia_battle_join_room(j->>'code', pg_temp.tok('a_tok'), 'あり');
  perform public.trivia_battle_save_state(pg_temp.g('room2')::uuid, pg_temp.tok('c_tok'), 2, '{
    "ready":{"A":true,"B":true},"settings":{"firstPlayer":"A","targetScore":3},
    "game":{"id":"22222222-2222-4222-8222-222222222222","phase":"select","questioner":"A",
      "hands":{"A":[3,9,10,11],"B":[]},"history":[],"scores":{"A":0,"B":0},"winner":null}}');
  -- この部屋で A（ゲスト）の持ち越し [2,3,4] のうち、C が出会った 3 は外れる
  j := public.trivia_battle_deal_info(pg_temp.g('room2')::uuid, pg_temp.tok('a_tok'));
  assert j->'hands'->'B' = '[2,4]'::jsonb, format('相手が出会った問題は持ち越さない: %s', j->'hands');
end $$;

-- 壊れた state でも保存はでき、記録だけが飛ばされる
do $$ declare j jsonb; begin
  j := public.trivia_battle_get_room(pg_temp.g('room2')::uuid, pg_temp.tok('a_tok'));
  j := public.trivia_battle_save_state(pg_temp.g('room2')::uuid, pg_temp.tok('a_tok'), (j->>'version')::int,
    '{"game":{"id":"33333333-3333-4333-8333-333333333333","hands":{"A":"x"},"history":[{"cardId":"abc"}],"phase":"over","winner":"A"}}');
  assert j is not null, '壊れた state でも保存はできる';
end $$;

-- ===== フィードバック =====
do $$ declare j jsonb; begin
  j := public.trivia_battle_save_feedback(pg_temp.tok('a_tok'), '  楽しかったです  ', 'title');
  assert j->>'email' = 'alice@example.com' and j->>'nickname' = 'あり', '送り主がわかる';
  j := public.trivia_battle_save_feedback(null, 'ログイン前の感想', null);
  assert j->>'email' is null, 'ログインしていなくても送れる';
  perform public.trivia_battle_save_feedback(pg_temp.tok('a_tok'), '2', null);
  perform public.trivia_battle_save_feedback(pg_temp.tok('a_tok'), '3', null);
  begin
    perform public.trivia_battle_save_feedback(pg_temp.tok('a_tok'), '4', null);
    raise exception 'FAIL: 短時間に何度も送れた';
  exception when program_limit_exceeded then null;
  end;
  begin
    perform public.trivia_battle_save_feedback(null, '   ', null);
    raise exception 'FAIL: 空のフィードバックを送れた';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- ===== 退出 =====
do $$ declare j jsonb; begin
  perform public.trivia_battle_leave_room(pg_temp.g('room')::uuid, pg_temp.tok('b_tok'));
  j := public.trivia_battle_get_room(pg_temp.g('room')::uuid, pg_temp.tok('a_tok'));
  assert j->'guest_id' = 'null'::jsonb and j->'state'->'game' = 'null'::jsonb, 'ゲストが出ると席が空き、対戦は中断';
  perform public.trivia_battle_leave_room(pg_temp.g('room')::uuid, pg_temp.tok('a_tok'));
  assert (public.trivia_battle_get_room(pg_temp.g('room')::uuid, pg_temp.tok('a_tok'))->>'closed')::boolean, 'ホストが出ると閉じる';
end $$;

reset role;

-- 記録はテーブルに残り、ほかのアプリのログインユーザー（authenticated）からも見えない
do $$ begin
  assert (select count(*) from public.trivia_battle_answers) = 2, '記録は二重にならない';
  assert (select count(*) from public.trivia_battle_games) = 2, '終わった対戦が記録される（壊れた手札・履歴は飛ばす）';
  assert (select count(*) from public.trivia_battle_answers where game_id = '33333333-3333-4333-8333-333333333333') = 0, '壊れた履歴は記録しない';
  assert (select count(*) from public.trivia_battle_feedback) = 4, 'フィードバックが保存される';
end $$;
set role authenticated;
do $$ begin
  begin
    perform count(*) from public.trivia_battle_answers;
    raise exception 'FAIL: authenticated が記録を読めた';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

select 'trivia_battle tests passed' as result;
