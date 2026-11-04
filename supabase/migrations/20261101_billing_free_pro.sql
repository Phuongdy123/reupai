-- ReupAI billing is server owned. Browser clients can only read their own rows.
-- New users can begin the Free plan after completing Supabase email verification.
alter table public.profiles alter column status set default 'approved';
create table if not exists public.billing_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  trial_completed integer not null default 0 check (trial_completed between 0 and 3),
  pro_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_key text not null,
  video_id text not null,
  mode text not null check (mode in ('subtitle', 'voiceover')),
  token_hash text not null unique,
  plan_at_start text not null check (plan_at_start in ('free', 'pro')),
  status text not null default 'reserved' check (status in ('reserved', 'running', 'completed', 'failed', 'cancelled')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, job_key)
);
create index if not exists billing_jobs_user_status_idx on public.billing_jobs (user_id, status, expires_at);

create table if not exists public.billing_orders (
  order_code bigint primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount integer not null check (amount = 149000),
  status text not null default 'pending' check (status in ('pending', 'paid', 'cancelled', 'failed')),
  checkout_url text,
  payment_link_id text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists billing_orders_user_created_idx on public.billing_orders (user_id, created_at desc);

alter table public.billing_accounts enable row level security;
alter table public.billing_jobs enable row level security;
alter table public.billing_orders enable row level security;

create policy "Read own billing account" on public.billing_accounts for select to authenticated using (user_id = auth.uid());
create policy "Read own billing jobs" on public.billing_jobs for select to authenticated using (user_id = auth.uid());
create policy "Read own billing orders" on public.billing_orders for select to authenticated using (user_id = auth.uid());

create or replace function public.billing_reserve_job(
  p_user_id uuid, p_job_key text, p_video_id text, p_mode text, p_token_hash text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  account_row public.billing_accounts%rowtype;
  active_count integer;
  chosen_plan text;
  created_id uuid;
begin
  if length(p_job_key) > 100 or length(p_video_id) > 100 or p_mode not in ('subtitle', 'voiceover') or length(p_token_hash) <> 64 then
    raise exception 'Dữ liệu job không hợp lệ';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));
  insert into public.billing_accounts (user_id) values (p_user_id) on conflict (user_id) do nothing;
  select * into account_row from public.billing_accounts where user_id = p_user_id for update;
  if exists(select 1 from public.billing_jobs where user_id = p_user_id and job_key = p_job_key) then
    return jsonb_build_object('allowed', false, 'reason', 'duplicate');
  end if;
  chosen_plan := case when account_row.pro_until > now() then 'pro' else 'free' end;
  if chosen_plan = 'free' then
    select count(*) into active_count from public.billing_jobs
      where user_id = p_user_id and plan_at_start = 'free'
        and status in ('reserved', 'running') and expires_at > now();
    if account_row.trial_completed + active_count >= 3 then
      return jsonb_build_object('allowed', false, 'reason', 'trial_exhausted', 'remaining', greatest(0, 3 - account_row.trial_completed));
    end if;
  end if;
  insert into public.billing_jobs (user_id, job_key, video_id, mode, token_hash, plan_at_start, expires_at)
    values (p_user_id, p_job_key, p_video_id, p_mode, p_token_hash, chosen_plan, now() + interval '72 hours') returning id into created_id;
  return jsonb_build_object('allowed', true, 'id', created_id, 'plan', chosen_plan);
end;
$$;

create or replace function public.billing_claim_job(
  p_token_hash text, p_video_id text, p_mode text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare job_row public.billing_jobs%rowtype;
begin
  select * into job_row from public.billing_jobs where token_hash = p_token_hash for update;
  if not found or job_row.video_id <> p_video_id or job_row.mode <> p_mode or job_row.expires_at <= now() or job_row.status <> 'reserved' then
    return jsonb_build_object('allowed', false);
  end if;
  update public.billing_jobs set status = 'running', updated_at = now() where id = job_row.id;
  return jsonb_build_object('allowed', true, 'id', job_row.id, 'plan', job_row.plan_at_start);
end;
$$;

create or replace function public.billing_finish_job(
  p_token_hash text, p_status text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  job_row public.billing_jobs%rowtype;
  remaining integer;
begin
  if p_status not in ('completed', 'failed', 'cancelled') then raise exception 'Trạng thái không hợp lệ'; end if;
  select * into job_row from public.billing_jobs where token_hash = p_token_hash for update;
  if not found then return jsonb_build_object('ok', false); end if;
  if job_row.status = p_status then return jsonb_build_object('ok', true, 'already_applied', true); end if;
  if job_row.status not in ('reserved', 'running') then return jsonb_build_object('ok', false); end if;
  if p_status = 'completed' and job_row.plan_at_start = 'free' then
    perform pg_advisory_xact_lock(hashtext(job_row.user_id::text));
    update public.billing_accounts set trial_completed = least(3, trial_completed + 1), updated_at = now()
      where user_id = job_row.user_id returning 3 - trial_completed into remaining;
  end if;
  update public.billing_jobs set status = p_status, updated_at = now() where id = job_row.id;
  return jsonb_build_object('ok', true, 'remaining', remaining);
end;
$$;

create or replace function public.billing_apply_paid_order(p_order_code bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare order_row public.billing_orders%rowtype;
declare new_until timestamptz;
begin
  select * into order_row from public.billing_orders where order_code = p_order_code for update;
  if not found or order_row.amount <> 149000 then return jsonb_build_object('ok', false); end if;
  if order_row.status = 'paid' then return jsonb_build_object('ok', true, 'already_applied', true); end if;
  insert into public.billing_accounts (user_id) values (order_row.user_id) on conflict (user_id) do nothing;
  update public.billing_accounts
    set pro_until = greatest(coalesce(pro_until, now()), now()) + interval '30 days', updated_at = now()
    where user_id = order_row.user_id returning pro_until into new_until;
  update public.billing_orders set status = 'paid', paid_at = now(), updated_at = now() where order_code = p_order_code;
  return jsonb_build_object('ok', true, 'pro_until', new_until);
end;
$$;

revoke all on function public.billing_reserve_job(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.billing_claim_job(text, text, text) from public, anon, authenticated;
revoke all on function public.billing_finish_job(text, text) from public, anon, authenticated;
revoke all on function public.billing_apply_paid_order(bigint) from public, anon, authenticated;
grant execute on function public.billing_reserve_job(uuid, text, text, text, text) to service_role;
grant execute on function public.billing_claim_job(text, text, text) to service_role;
grant execute on function public.billing_finish_job(text, text) to service_role;
grant execute on function public.billing_apply_paid_order(bigint) to service_role;
