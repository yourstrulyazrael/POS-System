create or replace function public.place_order(
  p_items jsonb,
  p_payment_method text,
  p_gcash_reference_last4 text
)
returns table (order_id uuid, subtotal numeric, tax numeric, total numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_item record;
  v_price numeric(10, 2);
  v_name text;
  v_stock integer;
  v_subtotal numeric(10, 2) := 0;
  v_item_count integer;
  v_unique_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if not exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'A staff profile is required';
  end if;
  if p_payment_method is null or p_payment_method not in ('cash', 'gcash') then
    raise exception 'Unsupported payment method';
  end if;
  if p_payment_method = 'gcash' and (
    p_gcash_reference_last4 is null
    or length(p_gcash_reference_last4) <> 4
    or p_gcash_reference_last4 !~ '^[0-9]{4}$'
  ) then
    raise exception 'GCash payments need the last 4 digits of the reference number';
  end if;
  if p_payment_method = 'cash' and p_gcash_reference_last4 is not null then
    raise exception 'Cash orders cannot include a GCash reference';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one item to the order';
  end if;

  select count(*), count(distinct item ->> 'product_id')
    into v_item_count, v_unique_count
    from jsonb_array_elements(p_items) as item;
  if v_item_count <> v_unique_count then
    raise exception 'An order cannot contain duplicate product rows';
  end if;

  insert into public.orders (employee_id, payment_method, gcash_reference_last4)
    values (auth.uid(), p_payment_method, p_gcash_reference_last4)
    returning id into v_order_id;

  for v_item in
    select product_id, quantity
    from jsonb_to_recordset(p_items) as input(product_id uuid, quantity integer)
  loop
    if v_item.product_id is null or v_item.quantity is null or v_item.quantity < 1 then
      raise exception 'Each order item needs a product and a positive quantity';
    end if;

    select price, name, stock into v_price, v_name, v_stock
    from public.products
    where id = v_item.product_id and active = true
    for update;

    if not found then
      raise exception 'A product in this order is no longer available';
    end if;
    if v_stock < v_item.quantity then
      raise exception 'Not enough stock for %', v_name;
    end if;

    update public.products
      set stock = stock - v_item.quantity, updated_at = now()
      where id = v_item.product_id;
    insert into public.order_items (order_id, product_id, product_name, quantity, unit_price)
      values (v_order_id, v_item.product_id, v_name, v_item.quantity, v_price);
    v_subtotal := v_subtotal + v_price * v_item.quantity;
  end loop;

  update public.orders
    set subtotal = v_subtotal, tax = 0, total = v_subtotal
    where id = v_order_id;

  return query select v_order_id, v_subtotal, 0::numeric, v_subtotal;
end;
$$;

revoke all on function public.place_order(jsonb, text, text) from public, anon;
grant execute on function public.place_order(jsonb, text, text) to authenticated;

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

  delete from public.orders;
  get diagnostics v_deleted_orders = row_count;
  return v_deleted_orders;
end;
$$;

revoke all on function public.reset_sales_history(text) from public, anon;
grant execute on function public.reset_sales_history(text) to authenticated;

create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
    set email = coalesce(new.email, '')
    where id = new.id and email is distinct from coalesce(new.email, '');
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed_pos_profile on auth.users;
create trigger on_auth_user_email_changed_pos_profile
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute procedure public.sync_profile_email();
