-- Allow the server to set a temporary test price without duplicating a
-- production price literal in database constraints/RPC logic.
alter table public.billing_orders
  drop constraint if exists billing_orders_amount_check;

alter table public.billing_orders
  add constraint billing_orders_amount_check check (amount >= 1000);

create or replace function public.billing_apply_paid_order(p_order_code bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare order_row public.billing_orders%rowtype;
declare new_until timestamptz;
begin
  select * into order_row from public.billing_orders where order_code = p_order_code for update;
  if not found or order_row.amount < 1000 then return jsonb_build_object('ok', false); end if;
  if order_row.status = 'paid' then return jsonb_build_object('ok', true, 'already_applied', true); end if;
  insert into public.billing_accounts (user_id) values (order_row.user_id) on conflict (user_id) do nothing;
  update public.billing_accounts
    set pro_until = greatest(coalesce(pro_until, now()), now()) + interval '30 days', updated_at = now()
    where user_id = order_row.user_id returning pro_until into new_until;
  update public.billing_orders set status = 'paid', paid_at = now(), updated_at = now() where order_code = p_order_code;
  return jsonb_build_object('ok', true, 'pro_until', new_until);
end;
$$;

revoke all on function public.billing_apply_paid_order(bigint) from public, anon, authenticated;
grant execute on function public.billing_apply_paid_order(bigint) to service_role;
