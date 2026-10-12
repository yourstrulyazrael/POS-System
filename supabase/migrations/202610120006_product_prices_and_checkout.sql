alter table public.products
  add column if not exists cost_price numeric(10, 2) not null default 0 check (cost_price >= 0),
  add column if not exists wholesale_price numeric(10, 2) not null default 0 check (wholesale_price >= 0);

alter table public.orders
  drop constraint if exists orders_payment_details_check;

alter table public.orders
  rename column gcash_reference_last4 to payment_reference_last4;

alter table public.orders
  add column cash_received numeric(10, 2),
  add column change_due numeric(10, 2);

update public.orders
  set payment_method = 'e_wallet'
  where payment_method = 'gcash';

update public.orders
  set cash_received = total,
      change_due = 0
  where payment_method = 'cash';

alter table public.orders
  add constraint orders_payment_details_check
  check (
    (
      payment_method = 'cash'
      and payment_reference_last4 is null
      and cash_received >= total
      and change_due = cash_received - total
    )
    or (
      payment_method in ('e_wallet', 'card')
      and payment_reference_last4 ~ '^[0-9]{4}$'
      and cash_received is null
      and change_due is null
    )
  );

drop function if exists public.place_order(jsonb, text, text);

create function public.place_order(
  p_items jsonb,
  p_payment_method text,
  p_payment_reference_last4 text,
  p_cash_received numeric
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
  if p_payment_method is null or p_payment_method not in ('cash', 'e_wallet', 'card') then
    raise exception 'Unsupported payment method';
  end if;
  if p_payment_method = 'cash' and (
    p_payment_reference_last4 is not null
    or p_cash_received is null
    or p_cash_received < 0
  ) then
    raise exception 'Cash payments need a valid amount received and cannot include a reference number';
  end if;
  if p_payment_method in ('e_wallet', 'card') and (
    p_payment_reference_last4 is null
    or length(p_payment_reference_last4) <> 4
    or p_payment_reference_last4 !~ '^[0-9]{4}$'
    or p_cash_received is not null
  ) then
    raise exception 'E-Wallet and card payments need the last 4 digits of the reference number';
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
  if p_payment_method = 'cash' and p_cash_received > 99999999.99 then
    raise exception 'Cash received exceeds the supported amount';
  end if;

  insert into public.orders (
    employee_id,
    payment_method,
    payment_reference_last4,
    cash_received,
    change_due
  )
  values (
    auth.uid(),
    p_payment_method,
    p_payment_reference_last4,
    case when p_payment_method = 'cash' then p_cash_received else null end,
    case when p_payment_method = 'cash' then p_cash_received else null end
  )
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

  if p_payment_method = 'cash' and p_cash_received < v_subtotal then
    raise exception 'Cash received must be at least the order total';
  end if;

  update public.orders
    set subtotal = v_subtotal,
        tax = 0,
        total = v_subtotal,
        change_due = case
          when p_payment_method = 'cash' then p_cash_received - v_subtotal
          else null
        end
    where id = v_order_id;

  return query select v_order_id, v_subtotal, 0::numeric, v_subtotal;
end;
$$;

revoke all on function public.place_order(jsonb, text, text, numeric) from public, anon;
grant execute on function public.place_order(jsonb, text, text, numeric) to authenticated;

drop function if exists public.get_admin_sales_chart(text);

create function public.get_admin_sales_chart(p_period text default 'today')
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
        coalesce(sum(orders.total) filter (where orders.payment_method = 'cash'), 0)::numeric as cash_total,
        coalesce(sum(orders.total) filter (where orders.payment_method = 'e_wallet'), 0)::numeric as e_wallet_total,
        coalesce(sum(orders.total) filter (where orders.payment_method = 'card'), 0)::numeric as card_total
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
