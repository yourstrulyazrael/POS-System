-- Desktop packaging: the app no longer has its own server, so the admin
-- actions that were API routes become database functions (this file) or the
-- pos-admin Edge Function (account changes that need the Auth admin API).

-- Whether the first-admin setup screen should be offered. Safe to expose:
-- it reveals only whether any admin exists.
create or replace function public.is_admin_setup_available()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (select 1 from public.profiles where role = 'admin');
$$;

revoke all on function public.is_admin_setup_available() from public;
grant execute on function public.is_admin_setup_available() to anon, authenticated;

-- Admin-only reset of all orders and their items, callable from the app.
-- Requires the exact confirmation phrase, so it can't be triggered by accident.
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
    raise exception 'Type RESET SALES HISTORY to confirm';
  end if;
  delete from public.orders where id is not null;
  get diagnostics v_deleted_orders = row_count;
  return v_deleted_orders;
end;
$$;

revoke all on function public.reset_sales_history(text) from public, anon;
grant execute on function public.reset_sales_history(text) to authenticated;
