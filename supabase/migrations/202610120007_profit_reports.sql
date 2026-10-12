alter table public.order_items
  add column if not exists unit_cost numeric(10, 2) check (unit_cost is null or unit_cost >= 0);

alter table public.products
  add column if not exists cost_price_known boolean not null default false;

create or replace function public.place_order(
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
  v_cost_price numeric(10, 2);
  v_cost_price_known boolean;
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

    select price, cost_price, cost_price_known, name, stock
      into v_price, v_cost_price, v_cost_price_known, v_name, v_stock
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
    insert into public.order_items (order_id, product_id, product_name, quantity, unit_price, unit_cost)
      values (
        v_order_id,
        v_item.product_id,
        v_name,
        v_item.quantity,
        v_price,
        case when v_cost_price_known then v_cost_price else null end
      );
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

create function public.get_admin_profit_report(p_period text default 'today')
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
        orders.total,
        coalesce(order_costs.has_cost_snapshot, false) as has_cost_snapshot,
        order_costs.cost_of_goods
      from public.orders
      left join order_costs on order_costs.order_id = orders.id
      where orders.created_at >= (v_start at time zone 'Asia/Manila')
        and orders.created_at < ((v_end + v_step) at time zone 'Asia/Manila')
    )
    select
      to_char(buckets.bucket, v_label_format),
      coalesce(sum(report_orders.total), 0)::numeric,
      coalesce(sum(report_orders.cost_of_goods) filter (where report_orders.has_cost_snapshot), 0)::numeric,
      coalesce(sum(report_orders.total - report_orders.cost_of_goods) filter (where report_orders.has_cost_snapshot), 0)::numeric,
      count(report_orders.total)::bigint,
      count(report_orders.total) filter (where report_orders.has_cost_snapshot)::bigint,
      count(report_orders.total) filter (where not report_orders.has_cost_snapshot)::bigint
    from buckets
    left join report_orders on report_orders.bucket = buckets.bucket
    group by buckets.bucket
    order by buckets.bucket;
end;
$$;

revoke all on function public.get_admin_profit_report(text) from public, anon;
grant execute on function public.get_admin_profit_report(text) to authenticated;
