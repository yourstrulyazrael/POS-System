create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role text not null default 'employee' check (role in ('admin', 'employee')),
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text not null,
  price numeric(10, 2) not null check (price > 0),
  stock integer not null default 0 check (stock >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.profiles (id) on delete set null,
  subtotal numeric(10, 2) not null default 0,
  tax numeric(10, 2) not null default 0,
  total numeric(10, 2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(10, 2) not null check (unit_price > 0)
);

create index if not exists orders_employee_created_idx
  on public.orders (employee_id, created_at desc);
create index if not exists order_items_order_idx on public.order_items (order_id);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

create or replace function public.create_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_pos_profile on auth.users;
create trigger on_auth_user_created_pos_profile
  after insert on auth.users
  for each row execute procedure public.create_profile_for_auth_user();

create or replace function public.bootstrap_first_admin(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtext('pos-bootstrap-first-admin'));
  if exists (select 1 from public.profiles where role = 'admin') then
    return false;
  end if;
  update public.profiles set role = 'admin' where id = p_user_id;
  return found;
end;
$$;

revoke all on function public.bootstrap_first_admin(uuid) from public, anon, authenticated;
grant execute on function public.bootstrap_first_admin(uuid) to service_role;

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

  v_tax := round(v_subtotal * 0.0825, 2);
  v_total := v_subtotal + v_tax;
  update public.orders
    set subtotal = v_subtotal, tax = v_tax, total = v_total
    where id = v_order_id;

  return query select v_order_id, v_subtotal, v_tax, v_total;
end;
$$;

revoke all on function public.place_order(jsonb) from public, anon;
grant execute on function public.place_order(jsonb) to authenticated;

create or replace function public.get_admin_dashboard_stats()
returns table (
  sales_total numeric,
  orders_today bigint,
  active_products bigint,
  units_in_stock bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access is required';
  end if;

  return query
    select
      coalesce((
        select sum(orders.total)
        from public.orders
        where orders.created_at >= (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC')
      ), 0)::numeric,
      (
        select count(*)
        from public.orders
        where orders.created_at >= (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC')
      ),
      (select count(*) from public.products where products.active = true),
      coalesce((select sum(products.stock) from public.products where products.active = true), 0)::bigint;
end;
$$;

revoke all on function public.get_admin_dashboard_stats() from public, anon;
grant execute on function public.get_admin_dashboard_stats() to authenticated;

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.products to authenticated;
grant select on public.orders, public.order_items to authenticated;

drop policy if exists "Staff can read their own profile and admins can read all" on public.profiles;
create policy "Staff can read their own profile and admins can read all"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "Authenticated staff can read active products" on public.products;
create policy "Authenticated staff can read active products"
  on public.products for select to authenticated
  using (active or (select public.is_admin()));

drop policy if exists "Admins can insert products" on public.products;
create policy "Admins can insert products"
  on public.products for insert to authenticated
  with check ((select public.is_admin()));

drop policy if exists "Admins can update products" on public.products;
create policy "Admins can update products"
  on public.products for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "Admins can delete products" on public.products;
create policy "Admins can delete products"
  on public.products for delete to authenticated
  using ((select public.is_admin()));

drop policy if exists "Staff can read own orders and admins can read all" on public.orders;
create policy "Staff can read own orders and admins can read all"
  on public.orders for select to authenticated
  using (employee_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "Staff can read items from visible orders" on public.order_items;
create policy "Staff can read items from visible orders"
  on public.order_items for select to authenticated
  using (
    exists (
      select 1 from public.orders
      where orders.id = order_items.order_id
        and (orders.employee_id = (select auth.uid()) or (select public.is_admin()))
    )
  );

insert into public.products (name, category, price, stock) values
  ('Sinandomeng Rice (1 kg)', 'Rice & Grains', 65.00, 40),
  ('Sardines (155 g)', 'Canned Goods', 25.00, 30),
  ('Corned Beef (150 g)', 'Canned Goods', 38.00, 24),
  ('Pancit Canton', 'Instant Noodles', 15.00, 36),
  ('Cup Noodles', 'Instant Noodles', 32.00, 18),
  ('Potato Chips', 'Snacks', 20.00, 25),
  ('SkyFlakes Crackers', 'Snacks', 12.00, 30),
  ('Bottled Water', 'Beverages', 15.00, 24),
  ('Cola (Small Bottle)', 'Beverages', 25.00, 20),
  ('3-in-1 Coffee Sachet', 'Coffee & Drinks', 12.00, 40),
  ('Powdered Juice Sachet', 'Coffee & Drinks', 10.00, 30),
  ('Soy Sauce (Small Bottle)', 'Condiments', 18.00, 18),
  ('Cooking Oil (250 ml)', 'Condiments', 35.00, 16),
  ('Shampoo Sachet', 'Personal Care', 8.00, 40),
  ('Bath Soap', 'Personal Care', 25.00, 20),
  ('Laundry Detergent Sachet', 'Household', 10.00, 36),
  ('Fresh Eggs (piece)', 'Rice & Grains', 10.00, 30)
on conflict (name) do nothing;
