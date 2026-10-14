-- The Bridge Studio: database, row-level security and storage.
-- Run this once in the Supabase SQL editor (or with `supabase db push`).

create extension if not exists pgcrypto;

-- ---------- people ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  full_name text not null default '',
  role text not null default 'producer' check (role in ('admin', 'producer', 'reviewer')),
  created_at timestamptz not null default now()
);

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid());
$$;

create or replace function public.has_role(roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = any (roles));
$$;

-- The very first account becomes admin. After that, nobody joins by signing up:
-- an admin invites them from the Team page, and the invite function adds their profile.
-- (Roles in user metadata are ignored, so a stray public sign-up never gains access.)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where role = 'admin') then
    insert into public.profiles (id, email, full_name, role)
    values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data ->> 'full_name', ''), 'admin')
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- content (JSON documents keyed by id) ----------
create table if not exists public.shows (
  id text primary key,
  data jsonb not null,
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);

create table if not exists public.characters (
  id text primary key,
  show_id text not null references public.shows (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.pronunciations (
  id text primary key,
  show_id text not null references public.shows (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.facts (
  id text primary key,
  show_id text not null references public.shows (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.assets (
  id text primary key,
  show_id text not null references public.shows (id) on delete cascade,
  data jsonb not null,
  created_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);

create table if not exists public.episodes (
  id text primary key,
  show_id text not null references public.shows (id) on delete cascade,
  number integer not null default 1,
  title text not null default '',
  status text not null default 'draft' check (status in ('draft', 'review', 'approved', 'published')),
  data jsonb not null,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists episodes_show_idx on public.episodes (show_id, number desc);

create table if not exists public.episode_versions (
  id bigserial primary key,
  episode_id text not null references public.episodes (id) on delete cascade,
  data jsonb not null,
  note text not null default '',
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
create index if not exists episode_versions_idx on public.episode_versions (episode_id, created_at desc);

create table if not exists public.comments (
  id text primary key,
  episode_id text not null references public.episodes (id) on delete cascade,
  data jsonb not null,
  author_id uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.jobs (
  id text primary key,
  episode_id text references public.episodes (id) on delete cascade,
  kind text not null,
  status text not null default 'queued',
  message text not null default '',
  progress integer not null default 0,
  result jsonb,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.usage_log (
  id bigserial primary key,
  kind text not null,
  units integer not null default 0,
  episode_id text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

-- API keys saved from Settings, encrypted by the Netlify functions. No client access at all.
create table if not exists public.secrets (
  name text primary key,
  ciphertext text not null,
  iv text not null,
  last4 text not null default '',
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);

-- Only admins and reviewers may approve or publish an episode.
create or replace function public.guard_episode_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('approved', 'published') and new.status is distinct from old.status
     and auth.uid() is not null and not public.has_role(array['admin', 'reviewer']) then
    raise exception 'Only an admin or reviewer can approve or publish an episode';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists episodes_status_guard on public.episodes;
create trigger episodes_status_guard before update on public.episodes
  for each row execute function public.guard_episode_status();

-- ---------- row-level security ----------
alter table public.profiles enable row level security;
alter table public.shows enable row level security;
alter table public.characters enable row level security;
alter table public.pronunciations enable row level security;
alter table public.facts enable row level security;
alter table public.assets enable row level security;
alter table public.episodes enable row level security;
alter table public.episode_versions enable row level security;
alter table public.comments enable row level security;
alter table public.jobs enable row level security;
alter table public.usage_log enable row level security;
alter table public.secrets enable row level security;

drop policy if exists "members read profiles" on public.profiles;
create policy "members read profiles" on public.profiles for select using (public.is_member());
drop policy if exists "edit own name" on public.profiles;
create policy "edit own name" on public.profiles for update using (id = auth.uid())
  with check (id = auth.uid() and role = (select p.role from public.profiles p where p.id = auth.uid()));

do $$
declare t text;
begin
  foreach t in array array['shows', 'characters', 'pronunciations', 'facts', 'assets'] loop
    execute format('drop policy if exists "members read" on public.%I', t);
    execute format('create policy "members read" on public.%I for select using (public.is_member())', t);
    execute format('drop policy if exists "producers write" on public.%I', t);
    execute format('create policy "producers write" on public.%I for all using (public.has_role(array[''admin'',''producer''])) with check (public.has_role(array[''admin'',''producer'']))', t);
  end loop;
end $$;

drop policy if exists "members read" on public.episodes;
create policy "members read" on public.episodes for select using (public.is_member());
drop policy if exists "producers create" on public.episodes;
create policy "producers create" on public.episodes for insert with check (public.has_role(array['admin', 'producer']));
drop policy if exists "members update" on public.episodes;
create policy "members update" on public.episodes for update using (public.is_member()) with check (public.is_member());
drop policy if exists "admins delete" on public.episodes;
create policy "admins delete" on public.episodes for delete using (public.has_role(array['admin', 'producer']));

drop policy if exists "members read" on public.episode_versions;
create policy "members read" on public.episode_versions for select using (public.is_member());
drop policy if exists "members add" on public.episode_versions;
create policy "members add" on public.episode_versions for insert with check (public.is_member());

drop policy if exists "members read" on public.comments;
create policy "members read" on public.comments for select using (public.is_member());
drop policy if exists "members add" on public.comments;
create policy "members add" on public.comments for insert with check (public.is_member());
drop policy if exists "authors update" on public.comments;
create policy "authors update" on public.comments for update using (public.is_member());
drop policy if exists "authors delete" on public.comments;
create policy "authors delete" on public.comments for delete using (author_id = auth.uid() or public.has_role(array['admin']));

drop policy if exists "members read" on public.jobs;
create policy "members read" on public.jobs for select using (public.is_member());
drop policy if exists "members read" on public.usage_log;
create policy "members read" on public.usage_log for select using (public.is_member());
-- secrets: intentionally no policies (service role only)

-- Table privileges. Supabase normally grants these by default; stating them keeps the
-- studio working on projects created with the Data API's automatic grants switched off.
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
grant execute on function public.is_member(), public.has_role(text[]) to anon, authenticated, service_role;
revoke all on public.secrets from anon, authenticated;
revoke all on all tables in schema public from anon;

-- ---------- storage ----------
insert into storage.buckets (id, name, public)
values ('media', 'media', false)
on conflict (id) do nothing;

drop policy if exists "members read media" on storage.objects;
create policy "members read media" on storage.objects for select using (bucket_id = 'media' and public.is_member());
drop policy if exists "members upload media" on storage.objects;
create policy "members upload media" on storage.objects for insert with check (bucket_id = 'media' and public.is_member());
drop policy if exists "members update media" on storage.objects;
create policy "members update media" on storage.objects for update using (bucket_id = 'media' and public.is_member());
drop policy if exists "members delete media" on storage.objects;
create policy "members delete media" on storage.objects for delete using (bucket_id = 'media' and public.has_role(array['admin', 'producer']));
