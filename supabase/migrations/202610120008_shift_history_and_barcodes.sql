alter table public.products
  add column if not exists barcode text;

alter table public.products
  drop constraint if exists products_barcode_format_check;

alter table public.products
  add constraint products_barcode_format_check
  check (barcode is null or barcode ~ '^[!-~]{1,64}$');

-- Only active products must have unique barcodes, so a removed product's
-- barcode can be reused by its replacement.
create unique index if not exists products_active_barcode_key
  on public.products (barcode)
  where barcode is not null and active;

create index if not exists orders_created_idx on public.orders (created_at desc);

-- Shifts are derived from order times in Asia/Manila:
--   day   = [day_start_hour, night_start_hour)
--   night = [night_start_hour, next day's day_start_hour)
-- A night shift that crosses midnight is dated to the evening it started.
-- Admins see every employee's shifts; employees see only their own.
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
        ((o.created_at at time zone 'Asia/Manila') - v_day_start)::date as business_date,
        case
          when ((o.created_at at time zone 'Asia/Manila') - v_day_start)::time < v_night_offset::time then 'day'
          else 'night'
        end as business_shift,
        coalesce((select sum(order_items.quantity) from public.order_items where order_items.order_id = o.id), 0)::bigint as item_quantity
      from public.orders as o
      where o.created_at >= ((v_first_date::timestamp + v_day_start) at time zone 'Asia/Manila')
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
      coalesce(sum(scoped.total), 0)::numeric,
      coalesce(sum(scoped.total) filter (where scoped.payment_method = 'cash'), 0)::numeric,
      coalesce(sum(scoped.total) filter (where scoped.payment_method = 'e_wallet'), 0)::numeric,
      coalesce(sum(scoped.total) filter (where scoped.payment_method = 'card'), 0)::numeric,
      jsonb_agg(
        jsonb_build_object(
          'id', scoped.id,
          'created_at', scoped.created_at,
          'total', scoped.total,
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
