-- 雑学カードバトル v2: 対戦部屋
--
-- ほかのアプリと同じ Supabase プロジェクトに同居できるように作ってある。
--   - テーブル・関数の名前はすべて trivia_battle_ で始まる
--   - Supabase Auth（ログイン・匿名サインイン）は使わない。プロジェクトの認証設定は変えなくてよい
--   - テーブルは anon / authenticated から直接読み書きできない（RLS 有効・ポリシーなし・権限なし）
--   - 部屋の操作はすべて下の RPC で行う。各プレイヤーは端末で作ったランダムな
--     player_id（相手にも見える）と token（本人だけが知る合言葉）を持ち、token で本人確認する
--   - 相手への通知は Realtime の Broadcast（アプリ側）で行うので、publication には追加しない

create table public.trivia_battle_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[0-9]{4}$'),
  host_player_id uuid not null,
  host_token uuid not null,
  host_name text not null check (char_length(host_name) between 1 and 12),
  guest_player_id uuid,
  guest_token uuid,
  guest_name text check (guest_name is null or char_length(guest_name) between 1 and 12),
  closed boolean not null default false,
  version integer not null default 1,
  state jsonb not null default
    '{"ready":{"A":false,"B":false},"settings":{"firstPlayer":"random","targetScore":3},"game":null}'::jsonb
    check (jsonb_typeof(state) = 'object' and pg_column_size(state) < 65536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.trivia_battle_rooms enable row level security;
revoke all on public.trivia_battle_rooms from anon, authenticated;

-- 部屋をアプリに返す形（token は含めない）
create function public.trivia_battle_room_json(r public.trivia_battle_rooms) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id,
    'code', r.code,
    'version', r.version,
    'host_id', r.host_player_id,
    'host_name', r.host_name,
    'guest_id', r.guest_player_id,
    'guest_name', r.guest_name,
    'closed', r.closed,
    'state', r.state
  )
$$;

-- 名前の前後の空白を消し、1〜12文字か確かめる
create function public.trivia_battle_clean_name(p_name text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  n text := btrim(coalesce(p_name, ''));
begin
  if char_length(n) not between 1 and 12 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  return n;
end;
$$;

-- 部屋をつくる。4桁のコードを空いているものから選ぶ。
create function public.trivia_battle_create_room(p_player_id uuid, p_token uuid, p_name text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.trivia_battle_rooms;
  n text := public.trivia_battle_clean_name(p_name);
  tries int := 0;
begin
  if p_player_id is null or p_token is null then
    raise exception 'invalid_player' using errcode = '22023';
  end if;
  -- 閉じた部屋と、半日動きのない部屋を片付ける（コードを再利用できるように）
  delete from public.trivia_battle_rooms where closed or updated_at < now() - interval '12 hours';
  loop
    begin
      insert into public.trivia_battle_rooms (code, host_player_id, host_token, host_name)
        values ((1000 + floor(random() * 9000))::int::text, p_player_id, p_token, n)
        returning * into r;
      return public.trivia_battle_room_json(r);
    exception when unique_violation then
      tries := tries + 1;
      if tries >= 100 then
        raise exception 'no_code_available';
      end if;
    end;
  end loop;
end;
$$;

-- 部屋コードで参加する。すでにメンバーなら（再読み込みなど）そのまま返す。
create function public.trivia_battle_join_room(p_code text, p_player_id uuid, p_token uuid, p_name text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.trivia_battle_rooms;
  n text := public.trivia_battle_clean_name(p_name);
begin
  if p_player_id is null or p_token is null then
    raise exception 'invalid_player' using errcode = '22023';
  end if;
  if p_code is null or p_code !~ '^[0-9]{4}$' then
    raise exception 'invalid_code' using errcode = '22023';
  end if;
  select * into r from public.trivia_battle_rooms where code = p_code and not closed for update;
  if not found then
    raise exception 'room_not_found' using errcode = 'P0002';
  end if;
  if p_token in (r.host_token, r.guest_token) then
    return public.trivia_battle_room_json(r);
  end if;
  if r.guest_token is not null or p_player_id = r.host_player_id then
    raise exception 'room_full' using errcode = '23505';
  end if;
  update public.trivia_battle_rooms
    set guest_player_id = p_player_id,
        guest_token = p_token,
        guest_name = n,
        state = jsonb_set(state, '{ready,B}', 'false'::jsonb),
        version = version + 1,
        updated_at = now()
    where id = r.id
    returning * into r;
  return public.trivia_battle_room_json(r);
end;
$$;

-- 部屋を読む。メンバーでなければ null。
create function public.trivia_battle_get_room(p_room_id uuid, p_token uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select public.trivia_battle_room_json(r)
  from public.trivia_battle_rooms r
  where r.id = p_room_id and p_token is not null and p_token in (r.host_token, r.guest_token)
$$;

-- ゲームの状態を保存する。p_version が今の version と同じときだけ保存し、version を1増やす。
-- ほかの人が先に更新していたら null（アプリは読み直してやり直す）。
create function public.trivia_battle_save_state(p_room_id uuid, p_token uuid, p_version integer, p_state jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.trivia_battle_rooms;
begin
  if p_state is null or jsonb_typeof(p_state) <> 'object' then
    raise exception 'invalid_state' using errcode = '22023';
  end if;
  update public.trivia_battle_rooms
    set state = p_state, version = version + 1, updated_at = now()
    where id = p_room_id
      and version = p_version
      and not closed
      and p_token is not null
      and p_token in (host_token, guest_token)
    returning * into r;
  if found then
    return public.trivia_battle_room_json(r);
  end if;
  if not exists (
    select 1 from public.trivia_battle_rooms
    where id = p_room_id and p_token is not null and p_token in (host_token, guest_token)
  ) then
    raise exception 'not_member' using errcode = '42501';
  end if;
  return null;
end;
$$;

-- 部屋を出る。ホストなら部屋を閉じ、ゲストなら席を空けて対戦を中断する。
create function public.trivia_battle_leave_room(p_room_id uuid, p_token uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_token is null then
    return;
  end if;
  update public.trivia_battle_rooms
    set closed = true, version = version + 1, updated_at = now()
    where id = p_room_id and host_token = p_token and not closed;
  update public.trivia_battle_rooms
    set guest_player_id = null,
        guest_token = null,
        guest_name = null,
        state = jsonb_set(jsonb_set(state, '{ready,B}', 'false'::jsonb), '{game}', 'null'::jsonb),
        version = version + 1,
        updated_at = now()
    where id = p_room_id and guest_token = p_token;
end;
$$;

-- 内部用の関数は外から呼べないようにする
revoke all on function public.trivia_battle_room_json(public.trivia_battle_rooms) from public, anon, authenticated;
revoke all on function public.trivia_battle_clean_name(text) from public, anon, authenticated;

-- アプリから呼ぶ関数（ログインなしで呼ぶので anon にも許可する）
revoke all on function public.trivia_battle_create_room(uuid, uuid, text) from public;
revoke all on function public.trivia_battle_join_room(text, uuid, uuid, text) from public;
revoke all on function public.trivia_battle_get_room(uuid, uuid) from public;
revoke all on function public.trivia_battle_save_state(uuid, uuid, integer, jsonb) from public;
revoke all on function public.trivia_battle_leave_room(uuid, uuid) from public;
grant execute on function public.trivia_battle_create_room(uuid, uuid, text) to anon, authenticated;
grant execute on function public.trivia_battle_join_room(text, uuid, uuid, text) to anon, authenticated;
grant execute on function public.trivia_battle_get_room(uuid, uuid) to anon, authenticated;
grant execute on function public.trivia_battle_save_state(uuid, uuid, integer, jsonb) to anon, authenticated;
grant execute on function public.trivia_battle_leave_room(uuid, uuid) to anon, authenticated;
