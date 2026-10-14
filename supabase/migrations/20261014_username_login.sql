-- Apply this after 20261014_account_access.sql for existing Reup AI projects.
alter table public.profiles add column if not exists username text;

alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles add constraint profiles_username_format
  check (username is null or username ~ '^[a-z0-9][a-z0-9_.-]{2,31}$');

create unique index if not exists profiles_username_unique
  on public.profiles (lower(username)) where username is not null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, username)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    lower(nullif(new.raw_user_meta_data ->> 'username', ''))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
