-- ローカルの素の PostgreSQL で Supabase の最小限の環境を再現する（テスト専用）
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
create publication supabase_realtime;
create role service_role nologin bypassrls;
grant usage on schema auth to service_role;
grant execute on function auth.uid() to service_role;
-- Supabase と同じく、public に作られるテーブルと関数はアプリ用ロールに権限が付く（実際の制限は RLS と migration の revoke）
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
