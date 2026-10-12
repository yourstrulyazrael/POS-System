-- Refunds and voids, cash drawer sessions (end-of-shift cash count), and
-- store details for printed receipts.
--
-- Money model: orders.total never changes. Refunds are recorded in refunds /
-- refund_items and accumulated on the order (refunded_total, refunded_cost).
-- A void is a full refund that also marks the order voided. Reports use net
-- figures: total - refunded_total.
--
-- Cash drawer sessions are created on the till (client id), so they work
-- offline. Sales and refunds carry the session they happened in; closing a
-- session records the counted cash against the expected cash.

alter table public.orders
  add column if not exists status text not null default 'completed',
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references public.profiles (id) on delete set null,
  add column if not exists void_reason text,
  add column if not exists refunded_total numeric(10, 2) not null default 0,
  add column if not exists refunded_cost numeric(10, 2) not null default 0,
  add column if not exists cash_session_id uuid;

alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check check (status in ('completed', 'voided'));
alter table public.orders drop constraint if exists orders_refunded_total_check;
alter table public.orders add constraint orders_refunded_total_check check (refunded_total >= 0 and refunded_total <= total);

create index if not exists orders_cash_session_idx on public.orders (cash_session_id) where cash_session_id is not null;

create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  client_refund_id uuid unique,
  order_id uuid not null references public.orders (id) on delete cascade,
  kind text not null check (kind in ('refund', 'void')),
  amount numeric(10, 2) not null check (amount > 0),
  cost_amount numeric(10, 2) not null default 0,
  method text not null check (method in ('cash', 'e_wallet', 'card')),
  restocked boolean not null,
  reason text not null check (length(reason) between 1 and 200),
  cash_session_id uuid,
  created_by uuid references public.profiles (id) on delete set null,
  created_by_name text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.refund_items (
  id uuid primary key default gen_random_uuid(),
  refund_id uuid not null references public.refunds (id) on delete cascade,
  order_item_id uuid not null references public.order_items (id) on delete cascade,
  quantity integer not null check (quantity > 0),
  amount numeric(10, 2) not null check (amount >= 0)
);

create index if not exists refunds_order_idx on public.refunds (order_id);
create index if not exists refunds_cash_session_idx on public.refunds (cash_session_id) where cash_session_id is not null;
create index if not exists refund_items_order_item_idx on public.refund_items (order_item_id);

alter table public.refunds enable row level security;
alter table public.refund_items enable row level security;

-- Visible to whoever can see the order (its cashier, or an admin). Writes only
-- through refund_order / void_order.
drop policy if exists "Staff can read refunds of visible orders" on public.refunds;
create policy "Staff can read refunds of visible orders"
  on public.refunds for select to authenticated
  using (exists (
    select 1 from public.orders
    where orders.id = refunds.order_id
      and (orders.employee_id = (select auth.uid()) or (select public.is_admin()))
  ));

drop policy if exists "Staff can read refund items of visible orders" on public.refund_items;
create policy "Staff can read refund items of visible orders"
  on public.refund_items for select to authenticated
  using (exists (
    select 1 from public.refunds
    join public.orders on orders.id = refunds.order_id
    where refunds.id = refund_items.refund_id
      and (orders.employee_id = (select auth.uid()) or (select public.is_admin()))
  ));

-- ---------------------------------------------------------------------------
-- Store details printed on receipts (one row).
-- ---------------------------------------------------------------------------
create table if not exists public.store_settings (
  id integer primary key default 1 check (id = 1),
  store_name text not null default 'Clover & Co.' check (length(store_name) between 1 and 80),
  address text not null default '' check (length(address) <= 200),
  phone text not null default '' check (length(phone) <= 40),
  tin text not null default '' check (length(tin) <= 40),
  receipt_footer text not null default 'Thank you for shopping with us!' check (length(receipt_footer) <= 200),
  updated_at timestamptz not null default now()
);

insert into public.store_settings (id) values (1) on conflict (id) do nothing;

alter table public.store_settings enable row level security;

drop policy if exists "Staff can read store settings" on public.store_settings;
create policy "Staff can read store settings"
  on public.store_settings for select to authenticated
  using (true);

drop policy if exists "Admins can update store settings" on public.store_settings;
create policy "Admins can update store settings"
  on public.store_settings for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Cash drawer sessions.
-- ---------------------------------------------------------------------------
create table if not exists public.cash_sessions (
  id uuid primary key,
  opened_by uuid references public.profiles (id) on delete set null,
  opened_by_name text not null default '',
  device_label text not null default '' check (length(device_label) <= 60),
  opened_at timestamptz not null,
  opening_float numeric(10, 2) not null check (opening_float >= 0),
  closed_at timestamptz,
  closed_by uuid references public.profiles (id) on delete set null,
  closed_by_name text not null default '',
  counted_cash numeric(10, 2) check (counted_cash >= 0),
  expected_cash numeric(10, 2),
  server_expected_cash numeric(10, 2),
  denominations jsonb not null default '{}'::jsonb,
  notes text not null default '' check (length(notes) <= 500),
  synced_at timestamptz not null default now()
);

create index if not exists cash_sessions_opened_idx on public.cash_sessions (opened_at desc);

alter table public.cash_sessions enable row level security;

drop policy if exists "Staff can read own cash sessions and admins all" on public.cash_sessions;
create policy "Staff can read own cash sessions and admins all"
  on public.cash_sessions for select to authenticated
  using (opened_by = (select auth.uid()) or closed_by = (select auth.uid()) or (select public.is_admin()));

-- Records the opening and/or closing of a till's drawer session. Safe to call
-- repeatedly (offline sync): a closed session is never reopened or changed.
-- Expected cash is also computed here from synced cash sales and cash refunds,
-- so an admin can compare the till's figure with the database's.
create or replace function public.sync_cash_session(
  p_id uuid,
  p_opened_by uuid,
  p_opened_at timestamptz,
  p_opening_float numeric,
  p_device_label text default '',
  p_closed_by uuid default null,
  p_closed_at timestamptz default null,
  p_counted_cash numeric default null,
  p_expected_cash numeric default null,
  p_denominations jsonb default '{}'::jsonb,
  p_notes text default ''
)
returns table (session_id uuid, server_expected_cash numeric, closed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.cash_sessions;
  v_server_expected numeric(10, 2);
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if p_id is null or p_opened_at is null then
    raise exception 'A cash session needs its id and opening time';
  end if;
  if (p_opened_by is distinct from auth.uid() or (p_closed_by is not null and p_closed_by is distinct from auth.uid())) and not public.is_admin() then
    raise exception 'Only the cashier who used this drawer, or an admin, can sync it';
  end if;
  if p_opening_float is null or p_opening_float < 0 or p_opening_float > 99999999.99 then
    raise exception 'Opening cash must be ₱0 or more';
  end if;
  if p_closed_at is not null and (p_counted_cash is null or p_counted_cash < 0 or p_counted_cash > 99999999.99) then
    raise exception 'Counted cash must be ₱0 or more';
  end if;

  select * into v_existing from public.cash_sessions where id = p_id for update;
  if not found then
    insert into public.cash_sessions (id, opened_by, opened_by_name, device_label, opened_at, opening_float)
    values (
      p_id,
      (select id from public.profiles where id = p_opened_by),
      coalesce((select coalesce(nullif(btrim(full_name), ''), email) from public.profiles where id = p_opened_by), ''),
      left(coalesce(p_device_label, ''), 60),
      least(p_opened_at, now()),
      round(p_opening_float, 2)
    );
  elsif v_existing.closed_at is not null then
    return query select v_existing.id, v_existing.server_expected_cash, true;
    return;
  end if;

  if p_closed_at is not null then
    select
      round(p_opening_float, 2)
      + coalesce((select sum(orders.total) from public.orders where orders.cash_session_id = p_id and orders.payment_method = 'cash'), 0)
      - coalesce((select sum(refunds.amount) from public.refunds where refunds.cash_session_id = p_id and refunds.method = 'cash'), 0)
    into v_server_expected;

    update public.cash_sessions
      set closed_at = least(p_closed_at, now()),
          closed_by = (select id from public.profiles where id = coalesce(p_closed_by, p_opened_by)),
          closed_by_name = coalesce((select coalesce(nullif(btrim(full_name), ''), email) from public.profiles where id = coalesce(p_closed_by, p_opened_by)), ''),
          counted_cash = round(p_counted_cash, 2),
          expected_cash = round(p_expected_cash, 2),
          server_expected_cash = v_server_expected,
          denominations = coalesce(p_denominations, '{}'::jsonb),
          notes = left(coalesce(p_notes, ''), 500),
          synced_at = now()
      where id = p_id;
    return query select p_id, v_server_expected, true;
    return;
  end if;

  return query select p_id, null::numeric, false;
end;
$$;

revoke all on function public.sync_cash_session(uuid, uuid, timestamptz, numeric, text, uuid, timestamptz, numeric, numeric, jsonb, text) from public, anon;
grant execute on function public.sync_cash_session(uuid, uuid, timestamptz, numeric, text, uuid, timestamptz, numeric, numeric, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Refunds and voids.
-- ---------------------------------------------------------------------------

-- Refund some or all items of a sale (admin only). p_items: [{ order_item_id,
-- quantity }]. Quantities can't exceed what is still unrefunded. Restocking
-- puts the items back into inventory. Idempotent by p_client_refund_id.
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
  v_already integer;
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
    select order_item_id, sum(quantity)::integer as quantity
    from jsonb_to_recordset(p_items) as input(order_item_id uuid, quantity integer)
    group by order_item_id
  loop
    if v_item.order_item_id is null or v_item.quantity is null or v_item.quantity < 1 then
      raise exception 'Each refunded item needs a positive quantity';
    end if;
    select * into v_line from public.order_items where id = v_item.order_item_id and order_id = p_order_id;
    if not found then
      raise exception 'An item isn’t part of this sale';
    end if;
    select coalesce(sum(refund_items.quantity), 0) into v_already
      from public.refund_items where refund_items.order_item_id = v_line.id;
    if v_item.quantity > v_line.quantity - v_already then
      raise exception 'Only % of % can still be refunded', v_line.quantity - v_already, v_line.product_name;
    end if;

    insert into public.refund_items (refund_id, order_item_id, quantity, amount)
      values (v_refund_id, v_line.id, v_item.quantity, v_line.unit_price * v_item.quantity);
    v_amount := v_amount + v_line.unit_price * v_item.quantity;
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

revoke all on function public.refund_order(uuid, jsonb, text, boolean, text, uuid, uuid) from public, anon;
grant execute on function public.refund_order(uuid, jsonb, text, boolean, text, uuid, uuid) to authenticated;

-- Void a whole sale: every item is put back in stock and the full amount is
-- returned by the original payment method. The cashier who made the sale can
-- void it within 30 minutes; admins can void any sale. A sale that already
-- has refunds can't be voided (refund the rest instead).
create or replace function public.void_order(
  p_order_id uuid,
  p_reason text,
  p_cash_session_id uuid default null
)
returns table (refund_id uuid, amount numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_refund_id uuid;
  v_cost numeric(10, 2);
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if p_reason is null or length(btrim(p_reason)) not between 1 and 200 then
    raise exception 'Enter a reason for the void (up to 200 characters)';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Sale not found';
  end if;
  if not public.is_admin() and not (v_order.employee_id = auth.uid() and v_order.created_at > now() - interval '30 minutes') then
    raise exception 'Only an admin can void this sale (cashiers can void their own sales within 30 minutes)';
  end if;
  if v_order.status = 'voided' then
    raise exception 'This sale is already voided';
  end if;
  if v_order.refunded_total > 0 then
    raise exception 'This sale already has refunds; refund the remaining items instead';
  end if;

  select coalesce(sum(coalesce(unit_cost, 0) * quantity), 0) into v_cost from public.order_items where order_id = p_order_id;

  insert into public.refunds (order_id, kind, amount, cost_amount, method, restocked, reason, cash_session_id, created_by, created_by_name)
  values (
    p_order_id, 'void', v_order.total, v_cost, v_order.payment_method, true, btrim(p_reason), p_cash_session_id, auth.uid(),
    coalesce((select coalesce(nullif(btrim(full_name), ''), email) from public.profiles where id = auth.uid()), '')
  )
  returning id into v_refund_id;

  insert into public.refund_items (refund_id, order_item_id, quantity, amount)
    select v_refund_id, order_items.id, order_items.quantity, order_items.unit_price * order_items.quantity
    from public.order_items where order_items.order_id = p_order_id;

  update public.products
    set stock = products.stock + lines.quantity, updated_at = now()
    from (
      select product_id, sum(quantity)::integer as quantity
      from public.order_items
      where order_id = p_order_id and product_id is not null
      group by product_id
    ) as lines
    where products.id = lines.product_id;

  update public.orders
    set status = 'voided',
        voided_at = now(),
        voided_by = auth.uid(),
        void_reason = btrim(p_reason),
        refunded_total = total,
        refunded_cost = v_cost
    where id = p_order_id;

  return query select v_refund_id, v_order.total;
end;
$$;

revoke all on function public.void_order(uuid, text, uuid) from public, anon;
grant execute on function public.void_order(uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Checkout: record the drawer session each sale belongs to.
-- ---------------------------------------------------------------------------
drop function if exists public.place_order(jsonb, text, text, numeric, boolean, uuid);

create function public.place_order(
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

revoke all on function public.place_order(jsonb, text, text, numeric, boolean, uuid, uuid) from public, anon;
grant execute on function public.place_order(jsonb, text, text, numeric, boolean, uuid, uuid) to authenticated;

drop function if exists public.sync_offline_order(uuid, uuid, timestamptz, jsonb, text, text, numeric, boolean);

create function public.sync_offline_order(
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

revoke all on function public.sync_offline_order(uuid, uuid, timestamptz, jsonb, text, text, numeric, boolean, uuid) from public, anon;
grant execute on function public.sync_offline_order(uuid, uuid, timestamptz, jsonb, text, text, numeric, boolean, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Reports use net figures (sales less refunds; voided sales count as zero and
-- aren't counted as orders). Refunds are attributed to the original sale.
-- ---------------------------------------------------------------------------

create or replace function public.get_admin_dashboard_stats(p_period text default 'today')
returns table (
  sales_total numeric,
  orders_today bigint,
  active_products bigint,
  units_in_stock bigint,
  active_employees bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period_start timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Admin access is required';
  end if;

  if p_period = 'today' then
    v_period_start := date_trunc('day', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila';
  elsif p_period = '7days' then
    v_period_start := now() - interval '7 days';
  elsif p_period = '30days' then
    v_period_start := now() - interval '30 days';
  else
    raise exception 'Unsupported report period';
  end if;

  return query
    select
      coalesce((
        select sum(orders.total - orders.refunded_total)
        from public.orders
        where orders.created_at >= v_period_start
      ), 0)::numeric,
      (
        select count(*)
        from public.orders
        where orders.created_at >= v_period_start and orders.status <> 'voided'
      ),
      (select count(*) from public.products where products.active = true),
      coalesce((select sum(products.stock) from public.products where products.active = true), 0)::bigint,
      (select count(*) from public.profiles where profiles.role = 'employee');
end;
$$;

revoke all on function public.get_admin_dashboard_stats(text) from public, anon;
grant execute on function public.get_admin_dashboard_stats(text) to authenticated;

create or replace function public.get_admin_sales_chart(p_period text default 'today')
returns table (
  bucket_label text,
  cash_total numeric,
  e_wallet_total numeric,
  card_total numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_start timestamp;
  v_end timestamp;
  v_step interval;
  v_granularity text;
  v_label_format text;
begin
  if not public.is_admin() then
    raise exception 'Admin access is required';
  end if;

  if p_period = 'today' then
    v_start := v_today::timestamp;
    v_end := v_start + interval '23 hours';
    v_step := interval '1 hour';
    v_granularity := 'hour';
    v_label_format := 'HH24:00';
  elsif p_period = '7days' then
    v_start := (v_today - 6)::timestamp;
    v_end := v_today::timestamp;
    v_step := interval '1 day';
    v_granularity := 'day';
    v_label_format := 'Mon DD';
  elsif p_period = '30days' then
    v_start := (v_today - 29)::timestamp;
    v_end := v_today::timestamp;
    v_step := interval '1 day';
    v_granularity := 'day';
    v_label_format := 'Mon DD';
  else
    raise exception 'Unsupported report period';
  end if;

  return query
    with buckets as (
      select generate_series(v_start, v_end, v_step) as bucket
    ),
    sales as (
      select
        date_trunc(v_granularity, orders.created_at at time zone 'Asia/Manila') as bucket,
        coalesce(sum(orders.total - orders.refunded_total) filter (where orders.payment_method = 'cash'), 0)::numeric as cash_total,
        coalesce(sum(orders.total - orders.refunded_total) filter (where orders.payment_method = 'e_wallet'), 0)::numeric as e_wallet_total,
        coalesce(sum(orders.total - orders.refunded_total) filter (where orders.payment_method = 'card'), 0)::numeric as card_total
      from public.orders
      where orders.created_at >= (v_start at time zone 'Asia/Manila')
        and orders.created_at < ((v_end + v_step) at time zone 'Asia/Manila')
      group by 1
    )
    select
      to_char(buckets.bucket, v_label_format),
      coalesce(sales.cash_total, 0)::numeric,
      coalesce(sales.e_wallet_total, 0)::numeric,
      coalesce(sales.card_total, 0)::numeric
    from buckets
    left join sales on sales.bucket = buckets.bucket
    order by buckets.bucket;
end;
$$;

revoke all on function public.get_admin_sales_chart(text) from public, anon;
grant execute on function public.get_admin_sales_chart(text) to authenticated;

create or replace function public.get_admin_profit_report(p_period text default 'today')
returns table (
  bucket_label text,
  revenue_total numeric,
  cost_of_goods numeric,
  net_profit numeric,
  orders_count bigint,
  orders_with_cost bigint,
  orders_without_cost bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_start timestamp;
  v_end timestamp;
  v_step interval;
  v_granularity text;
  v_label_format text;
begin
  if not public.is_admin() then
    raise exception 'Admin access is required';
  end if;

  if p_period = 'today' then
    v_start := v_today::timestamp;
    v_end := v_start + interval '23 hours';
    v_step := interval '1 hour';
    v_granularity := 'hour';
    v_label_format := 'HH24:00';
  elsif p_period = '7days' then
    v_start := (v_today - 6)::timestamp;
    v_end := v_today::timestamp;
    v_step := interval '1 day';
    v_granularity := 'day';
    v_label_format := 'Mon DD';
  elsif p_period = '30days' then
    v_start := (v_today - 29)::timestamp;
    v_end := v_today::timestamp;
    v_step := interval '1 day';
    v_granularity := 'day';
    v_label_format := 'Mon DD';
  else
    raise exception 'Unsupported report period';
  end if;

  return query
    with buckets as (
      select generate_series(v_start, v_end, v_step) as bucket
    ),
    order_costs as (
      select
        order_items.order_id,
        bool_and(order_items.unit_cost is not null) as has_cost_snapshot,
        sum(order_items.unit_cost * order_items.quantity) as cost_of_goods
      from public.order_items
      group by order_items.order_id
    ),
    report_orders as (
      select
        date_trunc(v_granularity, orders.created_at at time zone 'Asia/Manila') as bucket,
        orders.total - orders.refunded_total as net_total,
        coalesce(order_costs.has_cost_snapshot, false) as has_cost_snapshot,
        order_costs.cost_of_goods - orders.refunded_cost as net_cost
      from public.orders
      left join order_costs on order_costs.order_id = orders.id
      where orders.created_at >= (v_start at time zone 'Asia/Manila')
        and orders.created_at < ((v_end + v_step) at time zone 'Asia/Manila')
        and orders.status <> 'voided'
    )
    select
      to_char(buckets.bucket, v_label_format),
      coalesce(sum(report_orders.net_total), 0)::numeric,
      coalesce(sum(report_orders.net_cost) filter (where report_orders.has_cost_snapshot), 0)::numeric,
      coalesce(sum(report_orders.net_total - report_orders.net_cost) filter (where report_orders.has_cost_snapshot), 0)::numeric,
      count(report_orders.net_total)::bigint,
      count(report_orders.net_total) filter (where report_orders.has_cost_snapshot)::bigint,
      count(report_orders.net_total) filter (where not report_orders.has_cost_snapshot)::bigint
    from buckets
    left join report_orders on report_orders.bucket = buckets.bucket
    group by buckets.bucket
    order by buckets.bucket;
end;
$$;

revoke all on function public.get_admin_profit_report(text) from public, anon;
grant execute on function public.get_admin_profit_report(text) to authenticated;

create or replace function public.get_shift_history(
  p_period text default '7days',
  p_day_start_hour integer default 6,
  p_night_start_hour integer default 18
)
returns table (
  employee_id uuid,
  employee_name text,
  shift_date date,
  shift_type text,
  shift_start timestamptz,
  shift_end timestamptz,
  first_order_at timestamptz,
  last_order_at timestamptz,
  orders_count bigint,
  items_count bigint,
  sales_total numeric,
  cash_total numeric,
  e_wallet_total numeric,
  card_total numeric,
  orders jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_is_admin boolean := public.is_admin();
  v_day_start interval;
  v_night_offset interval;
  v_today date;
  v_first_date date;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if p_day_start_hour is null or p_night_start_hour is null
    or p_day_start_hour < 0 or p_night_start_hour > 23
    or p_night_start_hour <= p_day_start_hour then
    raise exception 'Shift hours must satisfy 0 <= day start < night start <= 23';
  end if;

  v_day_start := make_interval(hours => p_day_start_hour);
  v_night_offset := make_interval(hours => p_night_start_hour - p_day_start_hour);
  v_today := ((now() at time zone 'Asia/Manila') - v_day_start)::date;

  if p_period = 'today' then
    v_first_date := v_today;
  elsif p_period = '7days' then
    v_first_date := v_today - 6;
  elsif p_period = '30days' then
    v_first_date := v_today - 29;
  else
    raise exception 'Unsupported report period';
  end if;

  return query
    with scoped as (
      select
        o.*,
        o.total - o.refunded_total as net_total,
        ((o.created_at at time zone 'Asia/Manila') - v_day_start)::date as business_date,
        case
          when ((o.created_at at time zone 'Asia/Manila') - v_day_start)::time < v_night_offset::time then 'day'
          else 'night'
        end as business_shift,
        coalesce((select sum(order_items.quantity) from public.order_items where order_items.order_id = o.id), 0)::bigint as item_quantity
      from public.orders as o
      where o.created_at >= ((v_first_date::timestamp + v_day_start) at time zone 'Asia/Manila')
        and o.status <> 'voided'
        and (v_is_admin or o.employee_id = auth.uid())
    )
    select
      scoped.employee_id,
      max(scoped.employee_name),
      scoped.business_date,
      scoped.business_shift,
      case when scoped.business_shift = 'day'
        then (scoped.business_date::timestamp + v_day_start) at time zone 'Asia/Manila'
        else (scoped.business_date::timestamp + v_day_start + v_night_offset) at time zone 'Asia/Manila'
      end,
      case when scoped.business_shift = 'day'
        then (scoped.business_date::timestamp + v_day_start + v_night_offset) at time zone 'Asia/Manila'
        else (scoped.business_date::timestamp + interval '1 day' + v_day_start) at time zone 'Asia/Manila'
      end,
      min(scoped.created_at),
      max(scoped.created_at),
      count(*),
      sum(scoped.item_quantity)::bigint,
      coalesce(sum(scoped.net_total), 0)::numeric,
      coalesce(sum(scoped.net_total) filter (where scoped.payment_method = 'cash'), 0)::numeric,
      coalesce(sum(scoped.net_total) filter (where scoped.payment_method = 'e_wallet'), 0)::numeric,
      coalesce(sum(scoped.net_total) filter (where scoped.payment_method = 'card'), 0)::numeric,
      jsonb_agg(
        jsonb_build_object(
          'id', scoped.id,
          'created_at', scoped.created_at,
          'total', scoped.net_total,
          'payment_method', scoped.payment_method,
          'items', scoped.item_quantity
        )
        order by scoped.created_at
      )
    from scoped
    where scoped.business_date <= v_today
    group by scoped.employee_id, coalesce(scoped.employee_id::text, scoped.employee_name), scoped.business_date, scoped.business_shift
    order by scoped.business_date desc, scoped.business_shift desc, max(scoped.employee_name);
end;
$$;

revoke all on function public.get_shift_history(text, integer, integer) from public, anon;
grant execute on function public.get_shift_history(text, integer, integer) to authenticated;
