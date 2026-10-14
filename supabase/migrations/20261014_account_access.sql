-- Reup AI web accounts. This database stores identity and approval status only.
-- Video, jobs, SQLite, source metadata and Local Engine data stay on each user's machine.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  role text not null default 'user' check (role in ('user', 'admin')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users read their own account" on public.profiles
  for select to authenticated using (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, coalesce(new.email, ''), nullif(new.raw_user_meta_data ->> 'display_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.set_profile_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists on_profile_updated on public.profiles;
create trigger on_profile_updated before update on public.profiles
  for each row execute procedure public.set_profile_updated_at();

-- After registering and verifying the owner account, run this once in the Supabase SQL editor:
-- update public.profiles set role = 'admin', status = 'approved' where email = 'YOUR_ADMIN_EMAIL';
