-- 部屋の RPC・RLS・権限のテスト。失敗すると例外で止まる。
\set ON_ERROR_STOP on

insert into auth.users values
  ('00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-00000000000b'),
  ('00000000-0000-0000-0000-00000000000c');

create temp table t (id uuid, code text);
grant all on t to authenticated;

set role authenticated;

-- ホスト A が部屋をつくる
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into t select id, code from public.create_room('  ホスト ');
do $$ declare r public.rooms; begin
  select * into r from public.rooms;
  assert r.code ~ '^[0-9]{4}$', '4桁のコード';
  assert r.host_name = 'ホスト', '名前の前後の空白は消える';
  assert r.version = 1 and r.guest_id is null, '最初はゲストなし';
  assert r.state->'settings'->>'targetScore' = '3', '初期の設定';
end $$;

-- 名前が空・長すぎるとつくれない
do $$ begin
  begin
    perform public.create_room('   ');
    raise exception 'FAIL: 空の名前で部屋ができた';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.create_room('あいうえおかきくけこさしす');
    raise exception 'FAIL: 13文字の名前で部屋ができた';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- メンバー以外（C）からは見えない。テーブルへ直接 insert もできない
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
do $$ begin
  assert (select count(*) from public.rooms) = 0, 'メンバー以外には見えない';
  begin
    insert into public.rooms (code, host_id, host_name) values ('9999', '00000000-0000-0000-0000-00000000000c', 'x');
    raise exception 'FAIL: 直接 insert できた';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ゲスト B が参加する
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ declare r public.rooms; begin
  r := public.join_room((select code from t), 'ゲスト');
  assert r.guest_id = '00000000-0000-0000-0000-00000000000b', 'ゲストとして入る';
  assert r.version = 2, '参加で version が増える';
  r := public.join_room((select code from t), 'ゲスト');
  assert r.version = 2, 'もう一度呼んでも（再読み込み）そのまま';
  assert (select count(*) from public.rooms) = 1, 'ゲストからも見える';
end $$;

-- 3人目は入れない。存在しないコード・形式違いも拒否
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
do $$ begin
  begin
    perform public.join_room((select code from t), '3人目');
    raise exception 'FAIL: 満員の部屋に入れた';
  exception when unique_violation then
    assert sqlerrm = 'room_full', sqlerrm;
  end;
  begin
    perform public.join_room(case when (select code from t) = '1000' then '1001' else '1000' end, 'x');
    raise exception 'FAIL: ない部屋に入れた';
  exception when no_data_found then
    assert sqlerrm = 'room_not_found', sqlerrm;
  end;
  begin
    perform public.join_room('12a4', 'x');
    raise exception 'FAIL: 形式違いのコードが通った';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- C は state を書き換えられない（RLS で0件）
update public.rooms set state = '{}'::jsonb, version = version + 1;

-- メンバーは state と version だけ更新できる
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
update public.rooms set state = jsonb_set(state, '{ready,A}', 'true'::jsonb), version = 3 where version = 2;
do $$ begin
  assert (select state->'ready'->>'A' from public.rooms) = 'true', 'メンバーは state を更新できる';
  assert (select version from public.rooms) = 3, 'version も更新される';
  -- version を飛ばす更新は拒否
  begin
    update public.rooms set state = state, version = 10;
    raise exception 'FAIL: version を飛ばせた';
  exception when serialization_failure then null;
  end;
  -- 古い version を指定した更新は0件（同時更新の検出）
  update public.rooms set state = '{}'::jsonb, version = 3 where version = 2;
  assert (select state->'ready'->>'A' from public.rooms) = 'true', '古い version の更新は効かない';
  -- ほかの列は変えられない
  begin
    update public.rooms set host_name = '乗っ取り';
    raise exception 'FAIL: host_name を変えられた';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.rooms set guest_id = null;
    raise exception 'FAIL: guest_id を変えられた';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.rooms;
    raise exception 'FAIL: 削除できた';
  exception when insufficient_privilege then null;
  end;
end $$;

-- C の書き換えは効いていない
do $$ begin
  assert (select state ? 'settings' from public.rooms), 'メンバー以外の更新は効かない';
end $$;

-- ゲストが退出すると席が空き、対戦は中断される
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
update public.rooms set state = jsonb_set(state, '{game}', '{"round":1}'::jsonb), version = version + 1;
select public.leave_room((select id from t));
do $$ begin
  assert (select count(*) from public.rooms) = 0, '退出したゲストからはもう見えない';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$ declare r public.rooms; begin
  select * into r from public.rooms;
  assert r.guest_id is null and r.guest_name is null, '席が空く';
  assert r.state->'game' = 'null'::jsonb, '対戦は中断';
  assert r.state->'ready'->>'B' = 'false', 'ゲストの準備は外れる';
end $$;

-- 別の人（C）が空いた席に入れる
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
select public.join_room((select code from t), '次の人');

-- ホストが退出すると部屋は閉じ、そのコードでは入れない
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select public.leave_room((select id from t));
do $$ begin
  assert (select closed from public.rooms), '部屋が閉じる';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ begin
  begin
    perform public.join_room((select code from t), 'x');
    raise exception 'FAIL: 閉じた部屋に入れた';
  exception when no_data_found then null;
  end;
end $$;

-- 新しい部屋をつくると、閉じた部屋は片付けられる
select public.create_room('B の部屋');
reset role;
do $$ begin
  assert (select count(*) from public.rooms) = 1, '閉じた部屋は消える';
  assert (select host_name from public.rooms) = 'B の部屋';
end $$;

-- 未ログイン（anon）は RPC を呼べず、何も見えない
set role anon;
select set_config('request.jwt.claim.sub', '', false);
do $$ begin
  begin
    perform public.create_room('x');
    raise exception 'FAIL: anon が部屋をつくれた';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from public.rooms;
    raise exception 'FAIL: anon が読めた';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
select 'rooms tests passed' as result;
