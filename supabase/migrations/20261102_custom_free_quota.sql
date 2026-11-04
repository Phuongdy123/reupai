-- Per-account Free quotas.  Three completed videos remains the default.
-- A completed job consumes one use; failed/cancelled jobs do not.
alter table public.billing_accounts
  drop constraint if exists billing_accounts_trial_completed_check;

alter table public.billing_accounts
  add column if not exists free_limit integer not null default 3,
  add column if not exists quota_unlimited boolean not null default false;

update public.billing_accounts
set trial_completed = greatest(0, trial_completed),
    free_limit = greatest(1, free_limit);

alter table public.billing_accounts
  drop constraint if exists billing_accounts_trial_completed_nonnegative;
alter table public.billing_accounts
  add constraint billing_accounts_trial_completed_nonnegative check (trial_completed >= 0);
alter table public.billing_accounts
  drop constraint if exists billing_accounts_free_limit_positive;
alter table public.billing_accounts
  add constraint billing_accounts_free_limit_positive check (free_limit >= 1);

create or replace function public.billing_reserve_job(
  p_user_id uuid, p_job_key text, p_video_id text, p_mode text, p_token_hash text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  account_row public.billing_accounts%rowtype;
  active_count integer;
  chosen_plan text;
  created_id uuid;
  is_admin boolean;
begin
  if length(p_job_key) > 100 or length(p_video_id) > 100 or p_mode not in ('subtitle', 'voiceover') or length(p_token_hash) <> 64 then
    raise exception 'Dữ liệu job không hợp lệ';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));
  insert into public.billing_accounts (user_id) values (p_user_id) on conflict (user_id) do nothing;
  select * into account_row from public.billing_accounts where user_id = p_user_id for update;
  select exists(select 1 from public.profiles where id = p_user_id and role = 'admin') into is_admin;
  if exists(select 1 from public.billing_jobs where user_id = p_user_id and job_key = p_job_key) then
    return jsonb_build_object('allowed', false, 'reason', 'duplicate');
  end if;
  chosen_plan := case when is_admin or account_row.pro_until > now() then 'pro' else 'free' end;
  if chosen_plan = 'free' and not account_row.quota_unlimited then
    select count(*) into active_count from public.billing_jobs
      where user_id = p_user_id and plan_at_start = 'free'
        and status in ('reserved', 'running') and expires_at > now();
    if account_row.trial_completed + active_count >= account_row.free_limit then
      return jsonb_build_object(
        'allowed', false,
        'reason', 'trial_exhausted',
        'limit', account_row.free_limit,
        'remaining', greatest(0, account_row.free_limit - account_row.trial_completed)
      );
    end if;
  end if;
  insert into public.billing_jobs (user_id, job_key, video_id, mode, token_hash, plan_at_start, expires_at)
    values (p_user_id, p_job_key, p_video_id, p_mode, p_token_hash, chosen_plan, now() + interval '72 hours') returning id into created_id;
  return jsonb_build_object(
    'allowed', true,
    'id', created_id,
    'plan', chosen_plan,
    'limit', account_row.free_limit,
    'unlimited', is_admin or account_row.quota_unlimited or chosen_plan = 'pro'
  );
end;
$$;

create or replace function public.billing_finish_job(
  p_token_hash text, p_status text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  job_row public.billing_jobs%rowtype;
  account_row public.billing_accounts%rowtype;
  remaining integer;
begin
  if p_status not in ('completed', 'failed', 'cancelled') then raise exception 'Trạng thái không hợp lệ'; end if;
  select * into job_row from public.billing_jobs where token_hash = p_token_hash for update;
  if not found then return jsonb_build_object('ok', false); end if;
  if job_row.status = p_status then return jsonb_build_object('ok', true, 'already_applied', true); end if;
  if job_row.status not in ('reserved', 'running') then return jsonb_build_object('ok', false); end if;
  if p_status = 'completed' and job_row.plan_at_start = 'free' then
    perform pg_advisory_xact_lock(hashtext(job_row.user_id::text));
    update public.billing_accounts
      set trial_completed = trial_completed + 1, updated_at = now()
      where user_id = job_row.user_id returning * into account_row;
    remaining := case when account_row.quota_unlimited then null else greatest(0, account_row.free_limit - account_row.trial_completed) end;
  end if;
  update public.billing_jobs set status = p_status, updated_at = now() where id = job_row.id;
  return jsonb_build_object('ok', true, 'remaining', remaining);
end;
$$;

revoke all on function public.billing_reserve_job(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.billing_finish_job(text, text) from public, anon, authenticated;
grant execute on function public.billing_reserve_job(uuid, text, text, text, text) to service_role;
grant execute on function public.billing_finish_job(text, text) to service_role;
