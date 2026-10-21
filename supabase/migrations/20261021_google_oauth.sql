-- Google OAuth users have an email/name from Google but no ReupAI username.
-- They remain pending until an administrator approves their profile.
alter table public.profiles alter column username drop not null;

drop index if exists public.profiles_username_unique;
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
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', '')
    ),
    lower(nullif(new.raw_user_meta_data ->> 'username', ''))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
