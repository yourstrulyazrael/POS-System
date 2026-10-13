-- Decimal quantities for custom items: a Quick add item can be sold as
-- 0.25, 0.50, 1.75 and so on (at most 2 decimal places, up to 9,999), e.g.
-- a quarter kilo of something not in the product list. Catalog products are
-- still sold, stocked and refunded in whole numbers.
--
-- Each custom line's amount is rounded to the centavo, the same way the app
-- shows it. Refunds of custom items can be partial in the same steps.

alter table public.order_items
  alter column quantity type numeric(10, 2);

alter table public.order_items
  drop constraint if exists order_items_whole_product_quantity;
alter table public.order_items
  add constraint order_items_whole_product_quantity
  check (product_id is null or quantity = trunc(quantity));

alter table public.refund_items
  alter column quantity type numeric(10, 2);

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
    from jsonb_to_recordset(p_items) as input(product_id uuid, quantity numeric, description text, unit_price numeric, wholesale boolean)
  loop
    if v_item.quantity is null or v_item.quantity <= 0 then
      raise exception 'Each order item needs a positive quantity';
    end if;

    if v_item.product_id is null then
      v_description := btrim(coalesce(v_item.description, ''));
      if v_description = '' or length(v_description) > 120 then
        raise exception 'Custom items need a description of up to 120 characters';
      end if;
      if v_item.quantity > 9999 or v_item.quantity <> round(v_item.quantity, 2) then
        raise exception 'Custom item quantities go up to 9,999, with at most 2 decimal places';
      end if;
      if v_item.unit_price is null or v_item.unit_price <= 0 or v_item.unit_price > 999999.99 or v_item.unit_price <> round(v_item.unit_price, 2) then
        raise exception 'Custom items need a price above ₱0 with at most 2 decimal places';
      end if;
      insert into public.order_items (order_id, product_id, product_name, quantity, unit_price, unit_cost)
        values (v_order_id, null, v_description, v_item.quantity, v_item.unit_price, null);
      v_subtotal := v_subtotal + round(v_item.unit_price * v_item.quantity, 2);
      continue;
    end if;

    if v_item.quantity <> trunc(v_item.quantity) then
      raise exception 'Product quantities must be whole numbers';
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
    from jsonb_to_recordset(p_items) as input(product_id uuid, quantity numeric, description text, unit_price numeric, name text, wholesale boolean)
  loop
    if v_item.quantity is null or v_item.quantity <= 0 or v_item.quantity > 9999 or v_item.quantity <> round(v_item.quantity, 2) then
      raise exception 'Each item needs a quantity above 0 and up to 9,999, with at most 2 decimal places';
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
      if v_item.quantity <> trunc(v_item.quantity) then
        raise exception 'Product quantities must be whole numbers';
      end if;
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
    v_subtotal := v_subtotal + round(round(v_item.unit_price, 2) * v_item.quantity, 2);
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

create or replace function public.refund_order(
  p_order_id uuid,
  p_items jsonb,
  p_reason text,
  p_restock boolean,
  p_method text,
  p_cash_session_id uuid default null,
  p_client_refund_id uuid default null
)
returns table (refund_id uuid, amount numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_refund_id uuid;
  v_item record;
  v_line public.order_items;
  v_already numeric;
  v_amount numeric(10, 2) := 0;
  v_cost numeric(10, 2) := 0;
  v_line_count integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can refund a sale';
  end if;
  if p_client_refund_id is not null then
    return query select refunds.id, refunds.amount from public.refunds where refunds.client_refund_id = p_client_refund_id;
    if found then
      return;
    end if;
  end if;
  if p_reason is null or length(btrim(p_reason)) not between 1 and 200 then
    raise exception 'Enter a reason for the refund (up to 200 characters)';
  end if;
  if p_method is null or p_method not in ('cash', 'e_wallet', 'card') then
    raise exception 'Choose how the money is returned';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Choose at least one item to refund';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Sale not found';
  end if;
  if v_order.status = 'voided' then
    raise exception 'This sale was voided and can’t be refunded';
  end if;

  insert into public.refunds (client_refund_id, order_id, kind, amount, method, restocked, reason, cash_session_id, created_by, created_by_name)
  values (
    p_client_refund_id, p_order_id, 'refund', 0.01, p_method, coalesce(p_restock, false), btrim(p_reason), p_cash_session_id, auth.uid(),
    coalesce((select coalesce(nullif(btrim(full_name), ''), email) from public.profiles where id = auth.uid()), '')
  )
  returning id into v_refund_id;

  for v_item in
    select order_item_id, sum(quantity) as quantity
    from jsonb_to_recordset(p_items) as input(order_item_id uuid, quantity numeric)
    group by order_item_id
  loop
    if v_item.order_item_id is null or v_item.quantity is null or v_item.quantity <= 0 then
      raise exception 'Each refunded item needs a positive quantity';
    end if;
    select * into v_line from public.order_items where id = v_item.order_item_id and order_id = p_order_id;
    if not found then
      raise exception 'An item isn’t part of this sale';
    end if;
    if v_item.quantity <> round(v_item.quantity, 2) or (v_line.product_id is not null and v_item.quantity <> trunc(v_item.quantity)) then
      raise exception 'Refund whole numbers of products, and at most 2 decimal places of custom items';
    end if;
    select coalesce(sum(refund_items.quantity), 0) into v_already
      from public.refund_items where refund_items.order_item_id = v_line.id;
    if v_item.quantity > v_line.quantity - v_already then
      raise exception 'Only % of % can still be refunded', v_line.quantity - v_already, v_line.product_name;
    end if;

    insert into public.refund_items (refund_id, order_item_id, quantity, amount)
      values (v_refund_id, v_line.id, v_item.quantity, round(v_line.unit_price * v_item.quantity, 2));
    v_amount := v_amount + round(v_line.unit_price * v_item.quantity, 2);
    v_cost := v_cost + coalesce(v_line.unit_cost, 0) * v_item.quantity;
    v_line_count := v_line_count + 1;

    if coalesce(p_restock, false) and v_line.product_id is not null then
      update public.products set stock = stock + v_item.quantity, updated_at = now() where id = v_line.product_id;
    end if;
  end loop;

  if v_line_count = 0 or v_amount <= 0 then
    raise exception 'Choose at least one item to refund';
  end if;

  update public.refunds set amount = v_amount, cost_amount = v_cost where id = v_refund_id;
  update public.orders
    set refunded_total = refunded_total + v_amount,
        refunded_cost = refunded_cost + v_cost
    where id = p_order_id;

  return query select v_refund_id, v_amount;
end;
$$;
