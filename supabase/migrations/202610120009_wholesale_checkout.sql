alter table public.orders
  add column if not exists is_wholesale boolean not null default false;

-- Replace place_order with a version that can charge wholesale prices. Prices
-- are always read from products here, never from the client. In wholesale
-- mode a product without a wholesale price (0) is charged at retail.
drop function if exists public.place_order(jsonb, text, text, numeric);

create function public.place_order(
  p_items jsonb,
  p_payment_method text,
  p_payment_reference_last4 text,
  p_cash_received numeric,
  p_wholesale boolean default false
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
  v_stock integer;
  v_subtotal numeric(10, 2) := 0;
  v_item_count integer;
  v_unique_count integer;
  v_wholesale boolean := coalesce(p_wholesale, false);
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
    change_due,
    is_wholesale
  )
  values (
    auth.uid(),
    p_payment_method,
    p_payment_reference_last4,
    case when p_payment_method = 'cash' then p_cash_received else null end,
    case when p_payment_method = 'cash' then p_cash_received else null end,
    v_wholesale
  )
  returning id into v_order_id;

  for v_item in
    select product_id, quantity
    from jsonb_to_recordset(p_items) as input(product_id uuid, quantity integer)
  loop
    if v_item.product_id is null or v_item.quantity is null or v_item.quantity < 1 then
      raise exception 'Each order item needs a product and a positive quantity';
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

revoke all on function public.place_order(jsonb, text, text, numeric, boolean) from public, anon;
grant execute on function public.place_order(jsonb, text, text, numeric, boolean) to authenticated;
