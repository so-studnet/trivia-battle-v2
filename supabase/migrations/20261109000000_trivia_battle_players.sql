-- 雑学カードバトル v2: メールアドレスでのログイン・出会った問題・成績・フィードバック
--
-- 前のマイグレーションと同じく、ほかのアプリと同じプロジェクトに同居できるように作ってある。
--   - 名前はすべて trivia_battle_ で始める。Supabase Auth は使わない
--   - テーブルは anon / authenticated から直接読み書きできない。操作はすべて RPC
--   - ログインはメールアドレスだけ（パスワード・確認メールなし）。ログインすると
--     その端末用のセッション token を発行し、以後の RPC はこの token で本人確認する
--
-- 注意: 進行中の部屋は消える（部屋のメンバーの持ち方が変わるため）

-- ---------------------------------------------------------------------------
-- テーブル
-- ---------------------------------------------------------------------------

create table public.trivia_battle_players (
  id uuid primary key default gen_random_uuid(),
  email text not null unique
    check (char_length(email) <= 254 and email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  nickname text not null check (char_length(nickname) between 1 and 12),
  -- 前の対戦から持ち越す手札
  saved_hand integer[] not null default '{}' check (cardinality(saved_hand) <= 10),
  created_at timestamptz not null default now(),
  last_login_at timestamptz not null default now()
);

create table public.trivia_battle_sessions (
  token uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.trivia_battle_players (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);
create index trivia_battle_sessions_player_idx on public.trivia_battle_sessions (player_id);

-- プレイヤーが出会った問題（手札に配られた・出題された）
create table public.trivia_battle_seen (
  player_id uuid not null references public.trivia_battle_players (id) on delete cascade,
  card_id integer not null check (card_id between 1 and 100000),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (player_id, card_id)
);

-- 1問ごとの記録
create table public.trivia_battle_answers (
  game_id uuid not null,
  round integer not null check (round between 1 and 1000),
  card_id integer not null check (card_id between 1 and 100000),
  questioner_id uuid references public.trivia_battle_players (id) on delete set null,
  guesser_id uuid references public.trivia_battle_players (id) on delete set null,
  guess boolean not null,
  correct boolean not null,
  bet integer not null check (bet between 1 and 3),
  answered_at timestamptz not null default now(),
  primary key (game_id, round)
);
create index trivia_battle_answers_questioner_idx on public.trivia_battle_answers (questioner_id);
create index trivia_battle_answers_guesser_idx on public.trivia_battle_answers (guesser_id);

-- 終わった対戦
create table public.trivia_battle_games (
  id uuid primary key,
  host_id uuid references public.trivia_battle_players (id) on delete set null,
  guest_id uuid references public.trivia_battle_players (id) on delete set null,
  winner_id uuid references public.trivia_battle_players (id) on delete set null,
  host_name text not null,
  guest_name text not null,
  host_score integer not null,
  guest_score integer not null,
  target_score integer not null,
  finished_at timestamptz not null default now()
);
create index trivia_battle_games_host_idx on public.trivia_battle_games (host_id);
create index trivia_battle_games_guest_idx on public.trivia_battle_games (guest_id);

-- フィードバック（メール送信はアプリのサーバー側で行う）
create table public.trivia_battle_feedback (
  id uuid primary key default gen_random_uuid(),
  player_id uuid references public.trivia_battle_players (id) on delete set null,
  email text,
  nickname text,
  message text not null check (char_length(message) between 1 and 2000),
  page text check (page is null or char_length(page) <= 200),
  created_at timestamptz not null default now()
);

alter table public.trivia_battle_players enable row level security;
alter table public.trivia_battle_sessions enable row level security;
alter table public.trivia_battle_seen enable row level security;
alter table public.trivia_battle_answers enable row level security;
alter table public.trivia_battle_games enable row level security;
alter table public.trivia_battle_feedback enable row level security;
revoke all on public.trivia_battle_players, public.trivia_battle_sessions, public.trivia_battle_seen,
  public.trivia_battle_answers, public.trivia_battle_games, public.trivia_battle_feedback
  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 部屋のメンバーを token から players に変える
-- ---------------------------------------------------------------------------

drop function public.trivia_battle_create_room(uuid, uuid, text);
drop function public.trivia_battle_join_room(text, uuid, uuid, text);
drop function public.trivia_battle_get_room(uuid, uuid);
drop function public.trivia_battle_save_state(uuid, uuid, integer, jsonb);
drop function public.trivia_battle_leave_room(uuid, uuid);

delete from public.trivia_battle_rooms;
alter table public.trivia_battle_rooms
  drop column host_token,
  drop column guest_token,
  add constraint trivia_battle_rooms_host_fk foreign key (host_player_id)
    references public.trivia_battle_players (id) on delete cascade,
  add constraint trivia_battle_rooms_guest_fk foreign key (guest_player_id)
    references public.trivia_battle_players (id) on delete set null;

-- ---------------------------------------------------------------------------
-- 内部用の関数
-- ---------------------------------------------------------------------------

create function public.trivia_battle_clean_email(p_email text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  e text := lower(btrim(coalesce(p_email, '')));
begin
  if char_length(e) > 254 or e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  return e;
end;
$$;

create function public.trivia_battle_player_json(p public.trivia_battle_players) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'email', p.email, 'nickname', p.nickname)
$$;

-- token からプレイヤーを調べる。見つからなければ null
create function public.trivia_battle_player_of(p_token uuid) returns uuid
language plpgsql set search_path = '' as $$
declare
  pid uuid;
begin
  if p_token is null then
    return null;
  end if;
  select player_id into pid from public.trivia_battle_sessions where token = p_token;
  if pid is not null then
    -- 部屋の読み直しは頻繁なので、使った時刻の更新は1時間に1回まで
    update public.trivia_battle_sessions set last_used_at = now()
      where token = p_token and last_used_at < now() - interval '1 hour';
  end if;
  return pid;
end;
$$;

create function public.trivia_battle_require_player(p_token uuid) returns uuid
language plpgsql set search_path = '' as $$
declare
  pid uuid := public.trivia_battle_player_of(p_token);
begin
  if pid is null then
    raise exception 'not_logged_in' using errcode = '28000';
  end if;
  return pid;
end;
$$;

create function public.trivia_battle_new_session(p_player_id uuid) returns jsonb
language plpgsql set search_path = '' as $$
declare
  t uuid;
  p public.trivia_battle_players;
begin
  update public.trivia_battle_players set last_login_at = now() where id = p_player_id returning * into p;
  insert into public.trivia_battle_sessions (player_id) values (p_player_id) returning token into t;
  return jsonb_build_object('status', 'ok', 'token', t, 'player', public.trivia_battle_player_json(p));
end;
$$;

-- 対戦の状態から、出会った問題・1問ごとの記録・終わった対戦を記録する。
-- 何度呼ばれても同じ結果になる（保存のたびに呼ぶ）。記録に失敗しても対戦は止めない。
create function public.trivia_battle_record(r public.trivia_battle_rooms) returns void
language plpgsql set search_path = '' as $$
declare
  g jsonb := r.state -> 'game';
  gid uuid;
  t jsonb;
  questioner uuid;
  guesser uuid;
  winner uuid;
begin
  if g is null or jsonb_typeof(g) <> 'object'
     or coalesce(g ->> 'id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or r.guest_player_id is null then
    return;
  end if;
  gid := (g ->> 'id')::uuid;

  -- 手札に配られた問題
  if jsonb_typeof(g -> 'hands' -> 'A') = 'array' then
    insert into public.trivia_battle_seen as s (player_id, card_id)
      select r.host_player_id, x::int
      from jsonb_array_elements_text(g -> 'hands' -> 'A') x
      where x ~ '^[0-9]{1,5}$'
      on conflict (player_id, card_id) do update set last_seen_at = now()
        where s.last_seen_at < now() - interval '1 minute';
  end if;
  if jsonb_typeof(g -> 'hands' -> 'B') = 'array' then
    insert into public.trivia_battle_seen as s (player_id, card_id)
      select r.guest_player_id, x::int
      from jsonb_array_elements_text(g -> 'hands' -> 'B') x
      where x ~ '^[0-9]{1,5}$'
      on conflict (player_id, card_id) do update set last_seen_at = now()
        where s.last_seen_at < now() - interval '1 minute';
  end if;

  -- 出題された問題（2人とも出会った）と、1問ごとの記録
  if jsonb_typeof(g -> 'history') = 'array' then
    for t in select * from jsonb_array_elements(g -> 'history') loop
      continue when coalesce(t ->> 'cardId', '') !~ '^[0-9]{1,5}$'
        or coalesce(t ->> 'round', '') !~ '^[0-9]{1,4}$'
        or t ->> 'questioner' not in ('A', 'B')
        or jsonb_typeof(t -> 'guess') <> 'boolean'
        or jsonb_typeof(t -> 'correct') <> 'boolean'
        or coalesce(t ->> 'bet', '') !~ '^[1-3]$';
      if t ->> 'questioner' = 'A' then
        questioner := r.host_player_id;
        guesser := r.guest_player_id;
      else
        questioner := r.guest_player_id;
        guesser := r.host_player_id;
      end if;
      insert into public.trivia_battle_seen (player_id, card_id)
        values (questioner, (t ->> 'cardId')::int), (guesser, (t ->> 'cardId')::int)
        on conflict (player_id, card_id) do nothing;
      insert into public.trivia_battle_answers (game_id, round, card_id, questioner_id, guesser_id, guess, correct, bet)
        values (gid, (t ->> 'round')::int, (t ->> 'cardId')::int, questioner, guesser,
                (t ->> 'guess')::boolean, (t ->> 'correct')::boolean, (t ->> 'bet')::int)
        on conflict (game_id, round) do nothing;
    end loop;
  end if;

  -- 対戦が終わったら、結果と持ち越しの手札を保存する
  if g ->> 'phase' = 'over' and g ->> 'winner' in ('A', 'B') then
    winner := case when g ->> 'winner' = 'A' then r.host_player_id else r.guest_player_id end;
    insert into public.trivia_battle_games
      (id, host_id, guest_id, winner_id, host_name, guest_name, host_score, guest_score, target_score)
      values (gid, r.host_player_id, r.guest_player_id, winner, r.host_name, coalesce(r.guest_name, ''),
              coalesce((g -> 'scores' ->> 'A')::int, 0), coalesce((g -> 'scores' ->> 'B')::int, 0),
              coalesce((r.state -> 'settings' ->> 'targetScore')::int, 0))
      on conflict (id) do nothing;
    if jsonb_typeof(g -> 'hands' -> 'A') = 'array' then
      update public.trivia_battle_players
        set saved_hand = (select coalesce(array_agg(x::int), '{}') from (
          select x from jsonb_array_elements_text(g -> 'hands' -> 'A') x where x ~ '^[0-9]{1,5}$' limit 10) s)
        where id = r.host_player_id;
    end if;
    if jsonb_typeof(g -> 'hands' -> 'B') = 'array' then
      update public.trivia_battle_players
        set saved_hand = (select coalesce(array_agg(x::int), '{}') from (
          select x from jsonb_array_elements_text(g -> 'hands' -> 'B') x where x ~ '^[0-9]{1,5}$' limit 10) s)
        where id = r.guest_player_id;
    end if;
  end if;
exception when others then
  raise warning 'trivia_battle_record failed: %', sqlerrm;
end;
$$;

-- ---------------------------------------------------------------------------
-- ログイン
-- ---------------------------------------------------------------------------

-- メールアドレスでログインする。登録されていなければ {"status":"new"}
create function public.trivia_battle_login(p_email text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  pid uuid;
begin
  select id into pid from public.trivia_battle_players where email = public.trivia_battle_clean_email(p_email);
  if pid is null then
    return jsonb_build_object('status', 'new');
  end if;
  return public.trivia_battle_new_session(pid);
end;
$$;

-- 新しく登録してログインする。すでに登録されていれば、そのままログインする
create function public.trivia_battle_register(p_email text, p_nickname text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  e text := public.trivia_battle_clean_email(p_email);
  n text := public.trivia_battle_clean_name(p_nickname);
  pid uuid;
begin
  insert into public.trivia_battle_players (email, nickname) values (e, n)
    on conflict (email) do nothing
    returning id into pid;
  if pid is null then
    select id into pid from public.trivia_battle_players where email = e;
  end if;
  return public.trivia_battle_new_session(pid);
end;
$$;

-- この端末のログイン状態を確かめる。ログインしていなければ null
create function public.trivia_battle_me(p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  p public.trivia_battle_players;
begin
  select * into p from public.trivia_battle_players where id = public.trivia_battle_player_of(p_token);
  if not found then
    return null;
  end if;
  return public.trivia_battle_player_json(p);
end;
$$;

create function public.trivia_battle_logout(p_token uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.trivia_battle_sessions where token = p_token
$$;

-- ---------------------------------------------------------------------------
-- 部屋
-- ---------------------------------------------------------------------------

create function public.trivia_battle_create_room(p_token uuid, p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  pid uuid := public.trivia_battle_require_player(p_token);
  n text := public.trivia_battle_clean_name(p_name);
  r public.trivia_battle_rooms;
  tries int := 0;
begin
  update public.trivia_battle_players set nickname = n where id = pid;
  -- 閉じた部屋と、半日動きのない部屋を片付ける（コードを再利用できるように）
  delete from public.trivia_battle_rooms where closed or updated_at < now() - interval '12 hours';
  loop
    begin
      insert into public.trivia_battle_rooms (code, host_player_id, host_name)
        values ((1000 + floor(random() * 9000))::int::text, pid, n)
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

create function public.trivia_battle_join_room(p_code text, p_token uuid, p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  pid uuid := public.trivia_battle_require_player(p_token);
  n text := public.trivia_battle_clean_name(p_name);
  r public.trivia_battle_rooms;
begin
  if p_code is null or p_code !~ '^[0-9]{4}$' then
    raise exception 'invalid_code' using errcode = '22023';
  end if;
  select * into r from public.trivia_battle_rooms where code = p_code and not closed for update;
  if not found then
    raise exception 'room_not_found' using errcode = 'P0002';
  end if;
  if pid in (r.host_player_id, r.guest_player_id) then
    return public.trivia_battle_room_json(r);
  end if;
  if r.guest_player_id is not null then
    raise exception 'room_full' using errcode = '23505';
  end if;
  update public.trivia_battle_players set nickname = n where id = pid;
  update public.trivia_battle_rooms
    set guest_player_id = pid,
        guest_name = n,
        state = jsonb_set(state, '{ready,B}', 'false'::jsonb),
        version = version + 1,
        updated_at = now()
    where id = r.id
    returning * into r;
  return public.trivia_battle_room_json(r);
end;
$$;

create function public.trivia_battle_get_room(p_room_id uuid, p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  pid uuid := public.trivia_battle_player_of(p_token);
  r public.trivia_battle_rooms;
begin
  select * into r from public.trivia_battle_rooms
    where id = p_room_id and pid is not null and pid in (host_player_id, guest_player_id);
  if not found then
    return null;
  end if;
  return public.trivia_battle_room_json(r);
end;
$$;

create function public.trivia_battle_save_state(p_room_id uuid, p_token uuid, p_version integer, p_state jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  pid uuid := public.trivia_battle_player_of(p_token);
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
      and pid is not null
      and pid in (host_player_id, guest_player_id)
    returning * into r;
  if found then
    perform public.trivia_battle_record(r);
    return public.trivia_battle_room_json(r);
  end if;
  if pid is null or not exists (
    select 1 from public.trivia_battle_rooms where id = p_room_id and pid in (host_player_id, guest_player_id)
  ) then
    raise exception 'not_member' using errcode = '42501';
  end if;
  return null;
end;
$$;

create function public.trivia_battle_leave_room(p_room_id uuid, p_token uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  pid uuid := public.trivia_battle_player_of(p_token);
begin
  if pid is null then
    return;
  end if;
  update public.trivia_battle_rooms
    set closed = true, version = version + 1, updated_at = now()
    where id = p_room_id and host_player_id = pid and not closed;
  update public.trivia_battle_rooms
    set guest_player_id = null,
        guest_name = null,
        state = jsonb_set(jsonb_set(state, '{ready,B}', 'false'::jsonb), '{game}', 'null'::jsonb),
        version = version + 1,
        updated_at = now()
    where id = p_room_id and guest_player_id = pid;
end;
$$;

-- 対戦を始めるときに、2人が出会った問題と、持ち越しの手札を返す
create function public.trivia_battle_deal_info(p_room_id uuid, p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  pid uuid := public.trivia_battle_require_player(p_token);
  r public.trivia_battle_rooms;
  seen jsonb;
  hand_a jsonb;
  hand_b jsonb;
begin
  select * into r from public.trivia_battle_rooms
    where id = p_room_id and pid in (host_player_id, guest_player_id);
  if not found then
    raise exception 'not_member' using errcode = '42501';
  end if;
  select coalesce(jsonb_object_agg(card_id::text, ms), '{}'::jsonb) into seen from (
    select card_id, (extract(epoch from max(last_seen_at)) * 1000)::bigint as ms
    from public.trivia_battle_seen
    where player_id in (r.host_player_id, r.guest_player_id)
    group by card_id
  ) s;
  -- 持ち越しの手札は、相手がまだ出会っていないものだけ
  select coalesce(jsonb_agg(c order by i), '[]'::jsonb) into hand_a
    from public.trivia_battle_players p, unnest(p.saved_hand) with ordinality as u(c, i)
    where p.id = r.host_player_id
      and not exists (select 1 from public.trivia_battle_seen s where s.player_id = r.guest_player_id and s.card_id = c);
  select coalesce(jsonb_agg(c order by i), '[]'::jsonb) into hand_b
    from public.trivia_battle_players p, unnest(p.saved_hand) with ordinality as u(c, i)
    where p.id = r.guest_player_id
      and not exists (select 1 from public.trivia_battle_seen s where s.player_id = r.host_player_id and s.card_id = c);
  return jsonb_build_object('seenAt', seen, 'hands', jsonb_build_object('A', hand_a, 'B', hand_b));
end;
$$;

-- ---------------------------------------------------------------------------
-- 成績（自分の分だけ）
-- ---------------------------------------------------------------------------

create function public.trivia_battle_my_stats(p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  pid uuid := public.trivia_battle_require_player(p_token);
begin
  return jsonb_build_object(
    'answers', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'gameId', a.game_id, 'round', a.round, 'cardId', a.card_id,
        'role', case when a.guesser_id = pid then 'guesser' else 'questioner' end,
        'correct', a.correct, 'bet', a.bet, 'answeredAt', a.answered_at
      ) order by a.answered_at), '[]'::jsonb)
      from public.trivia_battle_answers a
      where pid in (a.questioner_id, a.guesser_id)
    ),
    'games', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', g.id,
        'finishedAt', g.finished_at,
        'won', g.winner_id = pid,
        'myScore', case when g.host_id = pid then g.host_score else g.guest_score end,
        'opponentScore', case when g.host_id = pid then g.guest_score else g.host_score end,
        'opponentId', case when g.host_id = pid then g.guest_id else g.host_id end,
        'opponentName', case when g.host_id = pid then g.guest_name else g.host_name end
      ) order by g.finished_at), '[]'::jsonb)
      from public.trivia_battle_games g
      where pid in (g.host_id, g.guest_id)
    ),
    'seenCount', (select count(*) from public.trivia_battle_seen where player_id = pid)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- フィードバック
-- ---------------------------------------------------------------------------

-- 保存して、メールに書く送り主の情報を返す。送りすぎは断る
create function public.trivia_battle_save_feedback(p_token uuid, p_message text, p_page text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  pid uuid := public.trivia_battle_player_of(p_token);
  p public.trivia_battle_players;
  m text := btrim(coalesce(p_message, ''));
  fid uuid;
begin
  if char_length(m) not between 1 and 2000 then
    raise exception 'invalid_message' using errcode = '22023';
  end if;
  if pid is not null and (
    select count(*) from public.trivia_battle_feedback
    where player_id = pid and created_at > now() - interval '10 minutes'
  ) >= 3 then
    raise exception 'too_many_feedback' using errcode = '54000';
  end if;
  if (select count(*) from public.trivia_battle_feedback where created_at > now() - interval '1 hour') >= 30 then
    raise exception 'too_many_feedback' using errcode = '54000';
  end if;
  select * into p from public.trivia_battle_players where id = pid;
  insert into public.trivia_battle_feedback (player_id, email, nickname, message, page)
    values (pid, p.email, p.nickname, m, left(p_page, 200))
    returning id into fid;
  return jsonb_build_object('id', fid, 'email', p.email, 'nickname', p.nickname);
end;
$$;

-- ---------------------------------------------------------------------------
-- 権限
-- ---------------------------------------------------------------------------

revoke all on function public.trivia_battle_clean_email(text) from public, anon, authenticated;
revoke all on function public.trivia_battle_player_json(public.trivia_battle_players) from public, anon, authenticated;
revoke all on function public.trivia_battle_player_of(uuid) from public, anon, authenticated;
revoke all on function public.trivia_battle_require_player(uuid) from public, anon, authenticated;
revoke all on function public.trivia_battle_new_session(uuid) from public, anon, authenticated;
revoke all on function public.trivia_battle_record(public.trivia_battle_rooms) from public, anon, authenticated;

revoke all on function public.trivia_battle_login(text) from public;
revoke all on function public.trivia_battle_register(text, text) from public;
revoke all on function public.trivia_battle_me(uuid) from public;
revoke all on function public.trivia_battle_logout(uuid) from public;
revoke all on function public.trivia_battle_create_room(uuid, text) from public;
revoke all on function public.trivia_battle_join_room(text, uuid, text) from public;
revoke all on function public.trivia_battle_get_room(uuid, uuid) from public;
revoke all on function public.trivia_battle_save_state(uuid, uuid, integer, jsonb) from public;
revoke all on function public.trivia_battle_leave_room(uuid, uuid) from public;
revoke all on function public.trivia_battle_deal_info(uuid, uuid) from public;
revoke all on function public.trivia_battle_my_stats(uuid) from public;
revoke all on function public.trivia_battle_save_feedback(uuid, text, text) from public;

grant execute on function public.trivia_battle_login(text) to anon, authenticated;
grant execute on function public.trivia_battle_register(text, text) to anon, authenticated;
grant execute on function public.trivia_battle_me(uuid) to anon, authenticated;
grant execute on function public.trivia_battle_logout(uuid) to anon, authenticated;
grant execute on function public.trivia_battle_create_room(uuid, text) to anon, authenticated;
grant execute on function public.trivia_battle_join_room(text, uuid, text) to anon, authenticated;
grant execute on function public.trivia_battle_get_room(uuid, uuid) to anon, authenticated;
grant execute on function public.trivia_battle_save_state(uuid, uuid, integer, jsonb) to anon, authenticated;
grant execute on function public.trivia_battle_leave_room(uuid, uuid) to anon, authenticated;
grant execute on function public.trivia_battle_deal_info(uuid, uuid) to anon, authenticated;
grant execute on function public.trivia_battle_my_stats(uuid) to anon, authenticated;
grant execute on function public.trivia_battle_save_feedback(uuid, text, text) to anon, authenticated;
