-- 雑学カードバトル v2: 対戦部屋
-- 利用者は匿名サインイン（auth.users に匿名ユーザーができる）で使う。
--   作成・参加・退出 … RPC（create_room / join_room / leave_room）
--   ゲームの進行     … 部屋のメンバーが state と version だけを更新できる
--   相手への通知     … Realtime（supabase_realtime publication）

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[0-9]{4}$'),
  host_id uuid not null references auth.users (id) on delete cascade,
  host_name text not null check (char_length(host_name) between 1 and 12),
  guest_id uuid references auth.users (id) on delete set null,
  guest_name text check (guest_name is null or char_length(guest_name) between 1 and 12),
  closed boolean not null default false,
  version integer not null default 1,
  state jsonb not null default
    '{"ready":{"A":false,"B":false},"settings":{"firstPlayer":"random","targetScore":3},"game":null}'::jsonb
    check (jsonb_typeof(state) = 'object' and pg_column_size(state) < 65536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 部屋のメンバーが直接更新するときは version を1つずつ増やすこと（同時更新の検出）。
-- updated_at は常に更新する。
create function public.rooms_before_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') and new.version <> old.version + 1 then
    raise exception 'version_mismatch' using errcode = '40001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger rooms_before_update before update on public.rooms
  for each row execute function public.rooms_before_update();

-- RLS: 部屋のメンバーだけが読める・更新できる。作成・削除は RPC だけ。
alter table public.rooms enable row level security;

create policy "members can read" on public.rooms for select to authenticated
  using ((select auth.uid()) in (host_id, guest_id));

create policy "members can update" on public.rooms for update to authenticated
  using ((select auth.uid()) in (host_id, guest_id))
  with check ((select auth.uid()) in (host_id, guest_id));

-- 列の権限: メンバーが直接変えられるのは state と version だけ
revoke all on public.rooms from anon, authenticated;
grant select on public.rooms to authenticated;
grant update (state, version) on public.rooms to authenticated;

-- 部屋をつくる。4桁のコードを空いているものから選ぶ。
create function public.create_room(p_name text) returns public.rooms
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  r public.rooms;
  tries int := 0;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  p_name := btrim(coalesce(p_name, ''));
  if char_length(p_name) not between 1 and 12 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  -- 閉じた部屋と、半日動きのない部屋を片付ける（コードを再利用できるように）
  delete from public.rooms where closed or updated_at < now() - interval '12 hours';
  loop
    begin
      insert into public.rooms (code, host_id, host_name)
        values ((1000 + floor(random() * 9000))::int::text, uid, p_name)
        returning * into r;
      return r;
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
create function public.join_room(p_code text, p_name text) returns public.rooms
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  r public.rooms;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_code is null or p_code !~ '^[0-9]{4}$' then
    raise exception 'invalid_code' using errcode = '22023';
  end if;
  p_name := btrim(coalesce(p_name, ''));
  if char_length(p_name) not between 1 and 12 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  select * into r from public.rooms where code = p_code and not closed for update;
  if not found then
    raise exception 'room_not_found' using errcode = 'P0002';
  end if;
  if uid in (r.host_id, r.guest_id) then
    return r;
  end if;
  if r.guest_id is not null then
    raise exception 'room_full' using errcode = '23505';
  end if;
  update public.rooms
    set guest_id = uid,
        guest_name = p_name,
        state = jsonb_set(state, '{ready,B}', 'false'::jsonb),
        version = version + 1
    where id = r.id
    returning * into r;
  return r;
end;
$$;

-- 部屋を出る。ホストなら部屋を閉じ、ゲストなら席を空けて対戦を中断する。
create function public.leave_room(p_room_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  update public.rooms
    set closed = true, version = version + 1
    where id = p_room_id and host_id = uid and not closed;
  update public.rooms
    set guest_id = null,
        guest_name = null,
        state = jsonb_set(jsonb_set(state, '{ready,B}', 'false'::jsonb), '{game}', 'null'::jsonb),
        version = version + 1
    where id = p_room_id and guest_id = uid;
end;
$$;

revoke all on function public.create_room(text) from public, anon;
revoke all on function public.join_room(text, text) from public, anon;
revoke all on function public.leave_room(uuid) from public, anon;
grant execute on function public.create_room(text) to authenticated;
grant execute on function public.join_room(text, text) to authenticated;
grant execute on function public.leave_room(uuid) to authenticated;

-- 相手の変更をすぐ受け取れるように Realtime に載せる
alter publication supabase_realtime add table public.rooms;
