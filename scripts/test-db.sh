#!/usr/bin/env bash
# 一時的な PostgreSQL を起動し、マイグレーションと RLS のテストを実行する。
# 必要: PostgreSQL 15 以上のサーバーとクライアント（initdb, pg_ctl, psql）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(dirname "$(command -v initdb 2>/dev/null || ls /usr/lib/postgresql/*/bin/initdb | tail -1)")}"
TMP="$(mktemp -d)"
PORT="${PGPORT_TEST:-54329}"
trap '"$PGBIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT

RUN=()
if [ "$(id -u)" = "0" ]; then
  # root では PostgreSQL を起動できないので postgres ユーザーで動かす
  chown -R postgres "$TMP"
  RUN=(runuser -u postgres --)
fi

"${RUN[@]}" "$PGBIN/initdb" -D "$TMP/data" -U postgres -A trust --locale=C.UTF-8 >/dev/null
"${RUN[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" -o "-p $PORT -k $TMP -c listen_addresses=''" -l "$TMP/log" -w start >/dev/null

PSQL=("${RUN[@]}" psql -h "$TMP" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -c "create database app"
"${PSQL[@]}" -d app -f "$ROOT/supabase/tests/supabase-stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d app -f "$f"
done
for f in "$ROOT"/supabase/tests/*.test.sql; do
  # テストごとにデータを空にする
  "${PSQL[@]}" -d app -c "truncate public.trivia_battle_rooms, public.trivia_battle_players, public.trivia_battle_answers, public.trivia_battle_games, public.trivia_battle_feedback cascade"
  "${PSQL[@]}" -d app -f "$f"
done
