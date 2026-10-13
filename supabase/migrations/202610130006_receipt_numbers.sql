-- Receipt numbers: MMDDYY-NNNN, counting up from 0001 each day (Philippine
-- time), e.g. 062526-0001 (a 10,000th sale in a day is 062526-10000). Numbered by the database when a sale is saved, so
-- two tills selling at once never get the same number. An offline sale is
-- numbered when it syncs (on the day it was made).
--
-- Additive: older app versions keep working; they just don't show the number.

alter table public.orders add column if not exists receipt_number text;

create table if not exists public.receipt_counters (
  day date primary key,
  last_number integer not null default 0
);

alter table public.receipt_counters enable row level security;
-- No policies: only the trigger below (as the table owner) uses it.

create or replace function public.assign_receipt_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := (coalesce(new.created_at, now()) at time zone 'Asia/Manila')::date;
  v_number integer;
begin
  if new.receipt_number is not null then
    return new;
  end if;
  insert into public.receipt_counters (day, last_number) values (v_day, 1)
    on conflict (day) do update set last_number = receipt_counters.last_number + 1
    returning last_number into v_number;
  new.receipt_number := to_char(v_day, 'MMDDYY') || '-' || lpad(v_number::text, greatest(4, length(v_number::text)), '0');
  return new;
end;
$$;

drop trigger if exists orders_receipt_number on public.orders;
create trigger orders_receipt_number
  before insert on public.orders
  for each row execute function public.assign_receipt_number();

-- Number past sales in the order they were made, per day.
with numbered as (
  select
    id,
    (created_at at time zone 'Asia/Manila')::date as day,
    row_number() over (partition by (created_at at time zone 'Asia/Manila')::date order by created_at, id) as position
  from public.orders
  where receipt_number is null
)
update public.orders
  set receipt_number = to_char(numbered.day, 'MMDDYY') || '-' || lpad(numbered.position::text, greatest(4, length(numbered.position::text)), '0')
  from numbered
  where orders.id = numbered.id;

insert into public.receipt_counters (day, last_number)
  select (created_at at time zone 'Asia/Manila')::date, count(*)
  from public.orders
  group by 1
on conflict (day) do update set last_number = greatest(receipt_counters.last_number, excluded.last_number);

create unique index if not exists orders_receipt_number_key on public.orders (receipt_number);
