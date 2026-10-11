alter table public.orders
  add column if not exists employee_name text not null default '';

update public.orders
  set employee_name = coalesce(nullif(btrim(profiles.full_name), ''), profiles.email, 'Former employee')
  from public.profiles
  where profiles.id = orders.employee_id
    and orders.employee_name = '';

update public.orders
  set employee_name = 'Former employee'
  where employee_name = '';

create or replace function public.set_order_employee_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.employee_id is not null then
    select coalesce(nullif(btrim(profiles.full_name), ''), profiles.email, 'Former employee')
      into new.employee_name
      from public.profiles
      where profiles.id = new.employee_id;
  end if;
  if new.employee_name is null or btrim(new.employee_name) = '' then
    new.employee_name := 'Former employee';
  end if;
  return new;
end;
$$;

drop trigger if exists set_order_employee_name_before_insert on public.orders;
create trigger set_order_employee_name_before_insert
  before insert on public.orders
  for each row
  execute procedure public.set_order_employee_name();

create or replace function public.get_admin_sales_chart(p_period text default 'today')
returns table (
  bucket_label text,
  cash_total numeric,
  gcash_total numeric
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
        coalesce(sum(orders.total) filter (where orders.payment_method = 'gcash'), 0)::numeric as gcash_total
      from public.orders
      where orders.created_at >= (v_start at time zone 'Asia/Manila')
        and orders.created_at < ((v_end + v_step) at time zone 'Asia/Manila')
      group by 1
    )
    select
      to_char(buckets.bucket, v_label_format),
      coalesce(sales.cash_total, 0)::numeric,
      coalesce(sales.gcash_total, 0)::numeric
    from buckets
    left join sales on sales.bucket = buckets.bucket
    order by buckets.bucket;
end;
$$;

revoke all on function public.get_admin_sales_chart(text) from public, anon;
grant execute on function public.get_admin_sales_chart(text) to authenticated;
