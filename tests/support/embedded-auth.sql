-- Minimal Supabase Auth contract for standalone embedded PostgreSQL only.
-- The integration tests still exercise the real migrations, PostgreSQL roles, and RLS.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (
  id uuid primary key,
  aud text,
  role text,
  email text unique,
  email_confirmed_at timestamptz,
  is_anonymous boolean not null default false,
  created_at timestamptz,
  updated_at timestamptz
);
create function auth.uid() returns uuid language sql stable as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;
grant usage on schema auth to anon, authenticated;
