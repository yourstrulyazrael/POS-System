create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products (id) on delete set null,
  actor_id uuid references public.profiles (id) on delete set null,
  quantity integer not null check (quantity > 0),
  note text,
  created_at timestamptz not null default now()
);

alter table public.stock_movements enable row level security;
grant select on public.stock_movements to authenticated;

drop policy if exists "Admins can read stock movements" on public.stock_movements;
create policy "Admins can read stock movements"
  on public.stock_movements for select to authenticated
  using ((select public.is_admin()));

create or replace function public.place_order(p_items jsonb)
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
  v_tax numeric(10, 2);
  v_total numeric(10, 2);
  v_item_count integer;
  v_unique_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if not exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'A staff profile is required';
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

  insert into public.orders (employee_id) values (auth.uid()) returning id into v_order_id;

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

  v_tax := round(v_subtotal * 0.12, 2);
  v_total := v_subtotal + v_tax;
  update public.orders
    set subtotal = v_subtotal, tax = v_tax, total = v_total
    where id = v_order_id;

  return query select v_order_id, v_subtotal, v_tax, v_total;
end;
$$;

drop function if exists public.get_admin_dashboard_stats();
drop function if exists public.get_admin_dashboard_stats(text);
create function public.get_admin_dashboard_stats(p_period text default 'today')
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
        select sum(orders.total)
        from public.orders
        where orders.created_at >= v_period_start
      ), 0)::numeric,
      (
        select count(*)
        from public.orders
        where orders.created_at >= v_period_start
      ),
      (select count(*) from public.products where products.active = true),
      coalesce((select sum(products.stock) from public.products where products.active = true), 0)::bigint,
      (select count(*) from public.profiles where profiles.role = 'employee');
end;
$$;

revoke all on function public.get_admin_dashboard_stats(text) from public, anon;
grant execute on function public.get_admin_dashboard_stats(text) to authenticated;

create or replace function public.restock_product(
  p_product_id uuid,
  p_quantity integer,
  p_note text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stock integer;
begin
  if not public.is_admin() then
    raise exception 'Admin access is required';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 1000000 then
    raise exception 'Restock quantity must be between 1 and 1,000,000';
  end if;
  if p_note is not null and length(p_note) > 200 then
    raise exception 'Restock note must be 200 characters or fewer';
  end if;

  update public.products
    set stock = stock + p_quantity, updated_at = now()
    where id = p_product_id and active = true
    returning stock into v_stock;
  if not found then
    raise exception 'Active product not found';
  end if;

  insert into public.stock_movements (product_id, actor_id, quantity, note)
    values (p_product_id, auth.uid(), p_quantity, nullif(btrim(p_note), ''));
  return v_stock;
end;
$$;

revoke all on function public.restock_product(uuid, integer, text) from public, anon;
grant execute on function public.restock_product(uuid, integer, text) to authenticated;
