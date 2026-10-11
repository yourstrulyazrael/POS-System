create or replace function public.reset_sales_history(p_confirmation text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted_orders bigint;
begin
  if not public.is_admin() then
    raise exception 'Admin access is required';
  end if;
  if p_confirmation is distinct from 'RESET SALES HISTORY' then
    raise exception 'Explicit confirmation is required';
  end if;

  delete from public.orders
    where id is not null;
  get diagnostics v_deleted_orders = row_count;
  return v_deleted_orders;
end;
$$;

revoke all on function public.reset_sales_history(text) from public, anon;
grant execute on function public.reset_sales_history(text) to authenticated;

create or replace function public.reset_sales_history_admin()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted_orders bigint;
begin
  delete from public.orders
    where id is not null;
  get diagnostics v_deleted_orders = row_count;
  return v_deleted_orders;
end;
$$;

revoke all on function public.reset_sales_history_admin() from public, anon, authenticated;
grant execute on function public.reset_sales_history_admin() to service_role;
