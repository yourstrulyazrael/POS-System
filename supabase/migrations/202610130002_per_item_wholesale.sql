-- Per-item wholesale: the cashier switches wholesale mode on or off before
-- adding items, so one sale can mix wholesale lines (bulk quantities) and
-- retail lines (single pieces) — even of the same product.
--
-- Each order line records whether it was charged wholesale. orders.is_wholesale
-- now means "has at least one wholesale line". Prices are still decided here,
-- never by the app: a line asks for wholesale, and gets it only if the product
-- has a wholesale price.

alter table public.order_items
  add column if not exists is_wholesale boolean not null default false;

-- Existing wholesale orders were wholesale for every product line.
update public.order_items
  set is_wholesale = true
  from public.orders
  where orders.id = order_items.order_id
    and orders.is_wholesale
    and order_items.product_id is not null
    and not order_items.is_wholesale;

create or replace function public.place_order(
  p_items jsonb,
  p_payment_method text,
  p_payment_reference_last4 text,
  p_cash_received numeric,
  p_wholesale boolean default false,
  p_client_order_id uuid default null,
  p_cash_session_id uuid default null
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
  v_wholesale_price numeric(10, 2);
  v_cost_price numeric(10, 2);
  v_cost_price_known boolean;
  v_name text;
  v_description text;
  v_stock integer;
  v_subtotal numeric(10, 2) := 0;
  v_product_rows integer;
  v_unique_products integer;
  v_wholesale boolean := coalesce(p_wholesale, false);
  v_line_wholesale boolean;
  v_any_wholesale boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if not exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'A staff profile is required';
  end if;

  -- Already recorded (a retry of the same sale): return it unchanged.
  if p_client_order_id is not null then
    return query
      select orders.id, orders.subtotal, orders.tax, orders.total
      from public.orders
      where orders.client_order_id = p_client_order_id;
    if found then
      return;
    end if;
  end if;

  perform public.assert_valid_payment(p_payment_method, p_payment_reference_last4, p_cash_received);
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one item to the order';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'An order can have at most 200 lines';
  end if;
  select count(item ->> 'product_id'), count(distinct (item ->> 'product_id') || ':' || coalesce(item ->> 'wholesale', 'false'))
    into v_product_rows, v_unique_products
    from jsonb_array_elements(p_items) as item;
  if v_product_rows <> v_unique_products then
    raise exception 'An order cannot contain duplicate product rows';
  end if;

  insert into public.orders (employee_id, payment_method, payment_reference_last4, cash_received, change_due, is_wholesale, client_order_id, cash_session_id)
  values (
    auth.uid(),
    p_payment_method,
    p_payment_reference_last4,
    case when p_payment_method = 'cash' then p_cash_received else null end,
    case when p_payment_method = 'cash' then p_cash_received else null end,
    v_wholesale,
    p_client_order_id,
    p_cash_session_id
  )
  on conflict (client_order_id) do nothing
  returning id into v_order_id;

  -- A concurrent request with the same key won the race: return its order.
  if v_order_id is null then
    return query
      select orders.id, orders.subtotal, orders.tax, orders.total
      from public.orders
      where orders.client_order_id = p_client_order_id;
    return;
  end if;

  for v_item in
    select product_id, quantity, description, unit_price, wholesale
    from jsonb_to_recordset(p_items) as input(product_id uuid, quantity integer, description text, unit_price numeric, wholesale boolean)
  loop
    if v_item.quantity is null or v_item.quantity < 1 then
      raise exception 'Each order item needs a positive quantity';
    end if;

    if v_item.product_id is null then
      v_description := btrim(coalesce(v_item.description, ''));
      if v_description = '' or length(v_description) > 120 then
        raise exception 'Custom items need a description of up to 120 characters';
      end if;
      if v_item.quantity > 9999 then
        raise exception 'Custom item quantity cannot exceed 9,999';
      end if;
      if v_item.unit_price is null or v_item.unit_price <= 0 or v_item.unit_price > 999999.99 or v_item.unit_price <> round(v_item.unit_price, 2) then
        raise exception 'Custom items need a price above ₱0 with at most 2 decimal places';
      end if;
      insert into public.order_items (order_id, product_id, product_name, quantity, unit_price, unit_cost)
        values (v_order_id, null, v_description, v_item.quantity, v_item.unit_price, null);
      v_subtotal := v_subtotal + v_item.unit_price * v_item.quantity;
      continue;
    end if;

    select price, wholesale_price, cost_price, cost_price_known, name, stock
      into v_price, v_wholesale_price, v_cost_price, v_cost_price_known, v_name, v_stock
      from public.products
      where id = v_item.product_id and active = true
      for update;
    if not found then
      raise exception 'A product in this order is no longer available';
    end if;
    if v_stock < v_item.quantity then
      raise exception 'Not enough stock for %', v_name;
    end if;
    -- Wholesale is chosen per line (falls back to the order-wide flag sent by
    -- older app versions); a product without a wholesale price stays retail.
    v_line_wholesale := coalesce(v_item.wholesale, v_wholesale) and v_wholesale_price > 0;
    if v_line_wholesale then
      v_price := v_wholesale_price;
      v_any_wholesale := true;
    end if;

    update public.products set stock = stock - v_item.quantity, updated_at = now() where id = v_item.product_id;
    insert into public.order_items (order_id, product_id, product_name, quantity, unit_price, unit_cost, is_wholesale)
      values (v_order_id, v_item.product_id, v_name, v_item.quantity, v_price, case when v_cost_price_known then v_cost_price else null end, v_line_wholesale);
    v_subtotal := v_subtotal + v_price * v_item.quantity;
  end loop;

  if p_payment_method = 'cash' and p_cash_received < v_subtotal then
    raise exception 'Cash received must be at least the order total';
  end if;

  update public.orders
    set subtotal = v_subtotal,
        tax = 0,
        total = v_subtotal,
        change_due = case when p_payment_method = 'cash' then p_cash_received - v_subtotal else null end,
        is_wholesale = v_any_wholesale
    where id = v_order_id;

  return query select v_order_id, v_subtotal, 0::numeric, v_subtotal;
end;
$$;

revoke all on function public.place_order(jsonb, text, text, numeric, boolean, uuid, uuid) from public, anon;
grant execute on function public.place_order(jsonb, text, text, numeric, boolean, uuid, uuid) to authenticated;

create or replace function public.sync_offline_order(
  p_client_order_id uuid,
  p_employee_id uuid,
  p_created_at timestamptz,
  p_items jsonb,
  p_payment_method text,
  p_payment_reference_last4 text,
  p_cash_received numeric,
  p_wholesale boolean default false,
  p_cash_session_id uuid default null
)
returns table (order_id uuid, total numeric, shortfalls integer, already_synced boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_item record;
  v_name text;
  v_stock integer;
  v_cost_price numeric(10, 2);
  v_cost_price_known boolean;
  v_product_exists boolean;
  v_line_name text;
  v_deducted integer;
  v_subtotal numeric(10, 2) := 0;
  v_shortfalls integer := 0;
  v_created_at timestamptz;
  v_employee_id uuid := p_employee_id;
  v_any_wholesale boolean := coalesce(p_wholesale, false);
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if p_client_order_id is null then
    raise exception 'An offline sale needs its sale id';
  end if;

  return query
    select orders.id, orders.total, 0, true
    from public.orders
    where orders.client_order_id = p_client_order_id;
  if found then
    return;
  end if;

  if v_employee_id is distinct from auth.uid() and not public.is_admin() then
    raise exception 'Only the cashier who made this sale, or an admin, can sync it';
  end if;
  -- The cashier's account may have been removed since; an admin can still
  -- sync the sale, which is then recorded without an employee.
  if v_employee_id is not null and not exists (select 1 from public.profiles where id = v_employee_id) then
    v_employee_id := null;
  end if;

  perform public.assert_valid_payment(p_payment_method, p_payment_reference_last4, p_cash_received);
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'The offline sale has no items';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'An order can have at most 200 lines';
  end if;

  -- The till's clock decides when the sale happened, but never in the future
  -- and never more than 90 days back.
  v_created_at := least(coalesce(p_created_at, now()), now());
  if v_created_at < now() - interval '90 days' then
    v_created_at := now();
  end if;

  insert into public.orders (employee_id, payment_method, payment_reference_last4, cash_received, change_due, is_wholesale, client_order_id, synced_from_offline, created_at, cash_session_id)
  values (
    v_employee_id,
    p_payment_method,
    p_payment_reference_last4,
    case when p_payment_method = 'cash' then p_cash_received else null end,
    case when p_payment_method = 'cash' then p_cash_received else null end,
    coalesce(p_wholesale, false),
    p_client_order_id,
    true,
    v_created_at,
    p_cash_session_id
  )
  on conflict (client_order_id) do nothing
  returning id into v_order_id;

  if v_order_id is null then
    return query
      select orders.id, orders.total, 0, true
      from public.orders
      where orders.client_order_id = p_client_order_id;
    return;
  end if;

  for v_item in
    select product_id, quantity, description, unit_price, name, wholesale
    from jsonb_to_recordset(p_items) as input(product_id uuid, quantity integer, description text, unit_price numeric, name text, wholesale boolean)
  loop
    if v_item.quantity is null or v_item.quantity < 1 or v_item.quantity > 9999 then
      raise exception 'Each item needs a quantity from 1 to 9,999';
    end if;
    if v_item.unit_price is null or v_item.unit_price <= 0 or v_item.unit_price > 999999.99 then
      raise exception 'Each item needs a price above ₱0';
    end if;

    v_product_exists := false;
    if v_item.product_id is not null then
      select name, stock, cost_price, cost_price_known
        into v_name, v_stock, v_cost_price, v_cost_price_known
        from public.products
        where id = v_item.product_id
        for update;
      v_product_exists := found;
    end if;

    if not v_product_exists then
      v_line_name := btrim(coalesce(v_item.name, v_item.description, ''));
      if v_line_name = '' then
        raise exception 'Each item needs a name';
      end if;
      insert into public.order_items (order_id, product_id, product_name, quantity, unit_price, unit_cost)
        values (v_order_id, null, left(v_line_name, 120), v_item.quantity, round(v_item.unit_price, 2), null);
    else
      v_deducted := least(v_stock, v_item.quantity);
      update public.products set stock = stock - v_deducted, updated_at = now() where id = v_item.product_id;
      if v_item.quantity > v_stock then
        insert into public.stock_shortfalls (product_id, order_id, product_name, shortfall)
          values (v_item.product_id, v_order_id, v_name, v_item.quantity - v_stock);
        v_shortfalls := v_shortfalls + 1;
      end if;
      insert into public.order_items (order_id, product_id, product_name, quantity, unit_price, unit_cost, is_wholesale)
        values (v_order_id, v_item.product_id, v_name, v_item.quantity, round(v_item.unit_price, 2), case when v_cost_price_known then v_cost_price else null end, coalesce(v_item.wholesale, false));
      if coalesce(v_item.wholesale, false) then
        v_any_wholesale := true;
      end if;
    end if;
    v_subtotal := v_subtotal + round(v_item.unit_price, 2) * v_item.quantity;
  end loop;

  if p_payment_method = 'cash' and p_cash_received < v_subtotal then
    raise exception 'Cash received is less than the sale total';
  end if;

  update public.orders
    set subtotal = v_subtotal,
        tax = 0,
        total = v_subtotal,
        change_due = case when p_payment_method = 'cash' then p_cash_received - v_subtotal else null end,
        is_wholesale = v_any_wholesale
    where id = v_order_id;

  return query select v_order_id, v_subtotal, v_shortfalls, false;
end;
$$;

revoke all on function public.sync_offline_order(uuid, uuid, timestamptz, jsonb, text, text, numeric, boolean, uuid) from public, anon;
grant execute on function public.sync_offline_order(uuid, uuid, timestamptz, jsonb, text, text, numeric, boolean, uuid) to authenticated;
