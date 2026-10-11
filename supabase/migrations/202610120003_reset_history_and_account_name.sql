create or replace function public.reset_sales_history_admin()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted_orders bigint;
begin
  delete from public.orders;
  get diagnostics v_deleted_orders = row_count;
  return v_deleted_orders;
end;
$$;

revoke all on function public.reset_sales_history_admin() from public, anon, authenticated;
grant execute on function public.reset_sales_history_admin() to service_role;

create or replace function public.sync_profile_auth_metadata()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
    set email = coalesce(new.email, ''),
        full_name = case
          when new.raw_user_meta_data ? 'full_name'
            then coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), full_name)
          else full_name
        end
    where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed_pos_profile on auth.users;
drop trigger if exists on_auth_user_metadata_changed_pos_profile on auth.users;
create trigger on_auth_user_metadata_changed_pos_profile
  after update of email, raw_user_meta_data on auth.users
  for each row
  when (
    old.email is distinct from new.email
    or old.raw_user_meta_data is distinct from new.raw_user_meta_data
  )
  execute procedure public.sync_profile_auth_metadata();
