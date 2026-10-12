-- Offline mode.
--
-- Every sale now carries a client-generated id (orders.client_order_id). The
-- app creates it before sending, so a retry after a dropped connection, or a
-- queued offline sale synced twice, can never be recorded twice.
--
-- Sales made offline are queued on the till and later sent to
-- sync_offline_order, which records them as they happened: the time of sale,
-- the cashier, and the prices the customer was actually charged. Stock is
-- deducted, but never below 0; any amount sold beyond the recorded stock is
-- logged in stock_shortfalls for an admin to recount.

alter table public.orders
  add column if not exists client_order_id uuid,
  add column if not exists synced_from_offline boolean not null default false;

create unique index if not exists orders_client_order_id_key on public.orders (client_order_id);

create table if not exists public.stock_shortfalls (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products (id) on delete cascade,
  order_id uuid references public.orders (id) on delete cascade,
  product_name text not null,
  shortfall integer not null check (shortfall > 0),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null
);

create index if not exists stock_shortfalls_open_idx on public.stock_shortfalls (created_at desc) where resolved_at is null;

alter table public.stock_shortfalls enable row level security;

drop policy if exists "Admins can read stock shortfalls" on public.stock_shortfalls;
create policy "Admins can read stock shortfalls"
  on public.stock_shortfalls for select to authenticated
  using ((select public.is_admin()));

drop policy if exists "Admins can resolve stock shortfalls" on public.stock_shortfalls;
create policy "Admins can resolve stock shortfalls"
  on public.stock_shortfalls for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- Shared validation for payments, used by both checkout functions.
create or replace function public.assert_valid_payment(
  p_payment_method text,
  p_payment_reference_last4 text,
  p_cash_received numeric
)
returns void
language plpgsql
immutable
as $$
begin
  if p_payment_method is null or p_payment_method not in ('cash', 'e_wallet', 'card') then
    raise exception 'Unsupported payment method';
  end if;
  if p_payment_method = 'cash' and (
    p_payment_reference_last4 is not null
    or p_cash_received is null
    or p_cash_received < 0
    or p_cash_received > 99999999.99
  ) then
    raise exception 'Cash payments need a valid amount received and cannot include a reference number';
  end if;
  if p_payment_method in ('e_wallet', 'card') and (
    p_payment_reference_last4 is null
    or p_payment_reference_last4 !~ '^[0-9]{4}$'
    or p_cash_received is not null
  ) then
    raise exception 'E-Wallet and card payments need the last 4 digits of the reference number';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Online checkout: same rules as before, plus the idempotency key.
-- ---------------------------------------------------------------------------
drop function if exists public.place_order(jsonb, text, text, numeric, boolean);

create function public.place_order(
  p_items jsonb,
  p_payment_method text,
  p_payment_reference_last4 text,
  p_cash_received numeric,
  p_wholesale boolean default false,
  p_client_order_id uuid default null
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
  select count(item ->> 'product_id'), count(distinct item ->> 'product_id')
    into v_product_rows, v_unique_products
    from jsonb_array_elements(p_items) as item;
  if v_product_rows <> v_unique_products then
    raise exception 'An order cannot contain duplicate product rows';
  end if;

  insert into public.orders (employee_id, payment_method, payment_reference_last4, cash_received, change_due, is_wholesale, client_order_id)
  values (
    auth.uid(),
    p_payment_method,
    p_payment_reference_last4,
    case when p_payment_method = 'cash' then p_cash_received else null end,
    case when p_payment_method = 'cash' then p_cash_received else null end,
    v_wholesale,
    p_client_order_id
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
    select product_id, quantity, description, unit_price
    from jsonb_to_recordset(p_items) as input(product_id uuid, quantity integer, description text, unit_price numeric)
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
    if v_wholesale and v_wholesale_price > 0 then
      v_price := v_wholesale_price;
    end if;

    update public.products set stock = stock - v_item.quantity, updated_at = now() where id = v_item.product_id;
    insert into public.order_items (order_id, product_id, product_name, quantity, unit_price, unit_cost)
      values (v_order_id, v_item.product_id, v_name, v_item.quantity, v_price, case when v_cost_price_known then v_cost_price else null end);
    v_subtotal := v_subtotal + v_price * v_item.quantity;
  end loop;

  if p_payment_method = 'cash' and p_cash_received < v_subtotal then
    raise exception 'Cash received must be at least the order total';
  end if;

  update public.orders
    set subtotal = v_subtotal,
        tax = 0,
        total = v_subtotal,
        change_due = case when p_payment_method = 'cash' then p_cash_received - v_subtotal else null end
    where id = v_order_id;

  return query select v_order_id, v_subtotal, 0::numeric, v_subtotal;
end;
$$;

revoke all on function public.place_order(jsonb, text, text, numeric, boolean, uuid) from public, anon;
grant execute on function public.place_order(jsonb, text, text, numeric, boolean, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Offline sales: record a sale that already happened at the till.
-- ---------------------------------------------------------------------------
-- p_items: [{ product_id, quantity, unit_price, name }]  catalog product lines
--          [{ description, quantity, unit_price }]       custom lines
-- Prices are the ones the customer paid offline. A product that was removed
-- (or no longer exists) is still recorded under its name. Only the cashier
-- who made the sale, or an admin, can sync it.
create or replace function public.sync_offline_order(
  p_client_order_id uuid,
  p_employee_id uuid,
  p_created_at timestamptz,
  p_items jsonb,
  p_payment_method text,
  p_payment_reference_last4 text,
  p_cash_received numeric,
  p_wholesale boolean default false
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

  insert into public.orders (employee_id, payment_method, payment_reference_last4, cash_received, change_due, is_wholesale, client_order_id, synced_from_offline, created_at)
  values (
    v_employee_id,
    p_payment_method,
    p_payment_reference_last4,
    case when p_payment_method = 'cash' then p_cash_received else null end,
    case when p_payment_method = 'cash' then p_cash_received else null end,
    coalesce(p_wholesale, false),
    p_client_order_id,
    true,
    v_created_at
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
    select product_id, quantity, description, unit_price, name
    from jsonb_to_recordset(p_items) as input(product_id uuid, quantity integer, description text, unit_price numeric, name text)
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
      insert into public.order_items (order_id, product_id, product_name, quantity, unit_price, unit_cost)
        values (v_order_id, v_item.product_id, v_name, v_item.quantity, round(v_item.unit_price, 2), case when v_cost_price_known then v_cost_price else null end);
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
        change_due = case when p_payment_method = 'cash' then p_cash_received - v_subtotal else null end
    where id = v_order_id;

  return query select v_order_id, v_subtotal, v_shortfalls, false;
end;
$$;

revoke all on function public.sync_offline_order(uuid, uuid, timestamptz, jsonb, text, text, numeric, boolean) from public, anon;
grant execute on function public.sync_offline_order(uuid, uuid, timestamptz, jsonb, text, text, numeric, boolean) to authenticated;
