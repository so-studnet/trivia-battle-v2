-- 部屋の RPC と権限のテスト。失敗すると例外で止まる。
-- アプリはログインなし（anon ロール）で RPC を呼ぶ。
\set ON_ERROR_STOP on

-- プレイヤー: A（ホスト）, B（ゲスト）, C（部外者）
-- player_id = ...a1 / ...b1 / ...c1, token = ...a2 / ...b2 / ...c2
create temp table t (id uuid, code text);
grant all on t to anon;

set role anon;

-- A が部屋をつくる
do $$ declare j jsonb; begin
  j := public.trivia_battle_create_room('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', '  ホスト ');
  insert into t values ((j->>'id')::uuid, j->>'code');
  assert j->>'code' ~ '^[0-9]{4}$', '4桁のコード';
  assert j->>'host_name' = 'ホスト', '名前の前後の空白は消える';
  assert j->>'host_id' = '00000000-0000-0000-0000-0000000000a1', 'player_id が返る';
  assert (j->>'version')::int = 1 and j->'guest_id' = 'null'::jsonb, '最初はゲストなし';
  assert not (j ? 'host_token') and j::text not like '%0000000000a2%', 'token は返さない';
  assert j->'state'->'settings'->>'targetScore' = '3', '初期の設定';
end $$;

-- 名前が空・長すぎるとつくれない
do $$ begin
  begin
    perform public.trivia_battle_create_room(gen_random_uuid(), gen_random_uuid(), '   ');
    raise exception 'FAIL: 空の名前で部屋ができた';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.trivia_battle_create_room(gen_random_uuid(), gen_random_uuid(), 'あいうえおかきくけこさしす');
    raise exception 'FAIL: 13文字の名前で部屋ができた';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- テーブルは直接読めない・書けない。内部用の関数も呼べない
do $$ begin
  begin
    perform count(*) from public.trivia_battle_rooms;
    raise exception 'FAIL: テーブルを直接読めた';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.trivia_battle_rooms set host_name = 'x';
    raise exception 'FAIL: テーブルを直接更新できた';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.trivia_battle_clean_name('x');
    raise exception 'FAIL: 内部用の関数を呼べた';
  exception when insufficient_privilege then null;
  end;
end $$;

-- B が参加する。同じ token でもう一度呼んでも（再読み込み）そのまま
do $$ declare j jsonb; begin
  j := public.trivia_battle_join_room((select code from t), '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2', 'ゲスト');
  assert j->>'guest_id' = '00000000-0000-0000-0000-0000000000b1', 'ゲストとして入る';
  assert (j->>'version')::int = 2, '参加で version が増える';
  j := public.trivia_battle_join_room((select code from t), '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2', 'ゲスト');
  assert (j->>'version')::int = 2, '再参加では変わらない';
end $$;

-- C は入れない（満員）。存在しないコード・形式違いも拒否
do $$ begin
  begin
    perform public.trivia_battle_join_room((select code from t), '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c2', '3人目');
    raise exception 'FAIL: 満員の部屋に入れた';
  exception when unique_violation then
    assert sqlerrm = 'room_full', sqlerrm;
  end;
  begin
    perform public.trivia_battle_join_room(case when (select code from t) = '1000' then '1001' else '1000' end, gen_random_uuid(), gen_random_uuid(), 'x');
    raise exception 'FAIL: ない部屋に入れた';
  exception when no_data_found then
    assert sqlerrm = 'room_not_found', sqlerrm;
  end;
  begin
    perform public.trivia_battle_join_room('12a4', gen_random_uuid(), gen_random_uuid(), 'x');
    raise exception 'FAIL: 形式違いのコードが通った';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- 読めるのはメンバーの token だけ。player_id を知っていても token がなければ読めない
do $$ begin
  assert public.trivia_battle_get_room((select id from t), '00000000-0000-0000-0000-0000000000a2') is not null, 'ホストは読める';
  assert public.trivia_battle_get_room((select id from t), '00000000-0000-0000-0000-0000000000b2') is not null, 'ゲストは読める';
  assert public.trivia_battle_get_room((select id from t), '00000000-0000-0000-0000-0000000000c2') is null, '部外者は読めない';
  assert public.trivia_battle_get_room((select id from t), '00000000-0000-0000-0000-0000000000a1') is null, 'player_id では読めない';
  assert public.trivia_battle_get_room((select id from t), null) is null, 'token なしでは読めない';
end $$;

-- 状態の保存: 今の version のときだけ保存され、version が1増える
do $$ declare j jsonb; begin
  j := public.trivia_battle_save_state((select id from t), '00000000-0000-0000-0000-0000000000a2', 2,
    '{"ready":{"A":true,"B":false},"settings":{"firstPlayer":"A","targetScore":5},"game":null}');
  assert (j->>'version')::int = 3, 'version が増える';
  assert j->'state'->'ready'->>'A' = 'true', '保存される';
  -- 古い version では null（同時更新の検出）
  assert public.trivia_battle_save_state((select id from t), '00000000-0000-0000-0000-0000000000b2', 2, '{}') is null, '古い version は保存しない';
  assert public.trivia_battle_get_room((select id from t), '00000000-0000-0000-0000-0000000000a2')->'state'->'ready'->>'A' = 'true', '古い version の保存は効かない';
  -- オブジェクト以外は拒否
  begin
    perform public.trivia_battle_save_state((select id from t), '00000000-0000-0000-0000-0000000000a2', 3, '[1]');
    raise exception 'FAIL: 配列を保存できた';
  exception when invalid_parameter_value then null;
  end;
  -- 部外者は保存できない
  begin
    perform public.trivia_battle_save_state((select id from t), '00000000-0000-0000-0000-0000000000c2', 3, '{}');
    raise exception 'FAIL: 部外者が保存できた';
  exception when insufficient_privilege then
    assert sqlerrm = 'not_member', sqlerrm;
  end;
end $$;

-- ゲストが退出すると席が空き、対戦は中断される
do $$ declare j jsonb; begin
  perform public.trivia_battle_save_state((select id from t), '00000000-0000-0000-0000-0000000000b2', 3,
    '{"ready":{"A":true,"B":true},"settings":{"firstPlayer":"A","targetScore":5},"game":{"round":1}}');
  perform public.trivia_battle_leave_room((select id from t), '00000000-0000-0000-0000-0000000000b2');
  assert public.trivia_battle_get_room((select id from t), '00000000-0000-0000-0000-0000000000b2') is null, '退出したゲストはもう読めない';
  j := public.trivia_battle_get_room((select id from t), '00000000-0000-0000-0000-0000000000a2');
  assert j->'guest_id' = 'null'::jsonb and j->'guest_name' = 'null'::jsonb, '席が空く';
  assert j->'state'->'game' = 'null'::jsonb, '対戦は中断';
  assert j->'state'->'ready'->>'B' = 'false', 'ゲストの準備は外れる';
  assert (j->>'version')::int = 5, '退出で version が増える';
  -- 部外者の退出は何も起きない
  perform public.trivia_battle_leave_room((select id from t), '00000000-0000-0000-0000-0000000000c2');
  assert (public.trivia_battle_get_room((select id from t), '00000000-0000-0000-0000-0000000000a2')->>'version')::int = 5, '部外者の退出は効かない';
end $$;

-- 空いた席には C が入れる。ホストの player_id を名乗っても入れない
do $$ begin
  begin
    perform public.trivia_battle_join_room((select code from t), '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c9', 'なりすまし');
    raise exception 'FAIL: ホストの player_id で入れた';
  exception when unique_violation then null;
  end;
  perform public.trivia_battle_join_room((select code from t), '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c2', '次の人');
end $$;

-- ホストが退出すると部屋は閉じ、保存も参加もできない。メンバーは closed を読める
do $$ declare j jsonb; begin
  perform public.trivia_battle_leave_room((select id from t), '00000000-0000-0000-0000-0000000000a2');
  j := public.trivia_battle_get_room((select id from t), '00000000-0000-0000-0000-0000000000c2');
  assert (j->>'closed')::boolean, '部屋が閉じる';
  assert public.trivia_battle_save_state((select id from t), '00000000-0000-0000-0000-0000000000c2', (j->>'version')::int, '{}') is null, '閉じた部屋には保存できない';
  begin
    perform public.trivia_battle_join_room((select code from t), gen_random_uuid(), gen_random_uuid(), 'x');
    raise exception 'FAIL: 閉じた部屋に入れた';
  exception when no_data_found then null;
  end;
end $$;

-- 新しい部屋をつくると、閉じた部屋は片付けられる
select public.trivia_battle_create_room(gen_random_uuid(), gen_random_uuid(), '新しい部屋') is not null as created;
reset role;
do $$ begin
  assert (select count(*) from public.trivia_battle_rooms) = 1, '閉じた部屋は消える';
  assert (select host_name from public.trivia_battle_rooms) = '新しい部屋';
end $$;

-- ログイン済みのユーザー（同じプロジェクトの別アプリの利用者）もテーブルは直接読めない
set role authenticated;
do $$ begin
  begin
    perform count(*) from public.trivia_battle_rooms;
    raise exception 'FAIL: authenticated がテーブルを読めた';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
select 'trivia_battle_rooms tests passed' as result;
