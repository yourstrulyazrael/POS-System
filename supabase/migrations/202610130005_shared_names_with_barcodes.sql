-- Products with barcodes may share a name ("Coke" 330ml and "Coke" 1.5L):
-- the barcode tells them apart. Names must still be unique (ignoring
-- capitals) among products for sale that have NO barcode.
--
-- Imports: a row with a barcode updates the product with that barcode, else
-- gives that barcode to the product of the same name that has none, else
-- restores a removed product (barcode, then name), else adds a new product.
-- A row without a barcode updates the one product with that name; if several
-- share it, the row must include its barcode.

drop index if exists public.products_active_name_key;

create unique index if not exists products_active_unbarcoded_name_key
  on public.products (lower(name))
  where active and barcode is null;

create or replace function public.import_products(p_rows jsonb, p_replace boolean default false)
returns table (imported integer, removed integer, added integer, restored integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_name text;
  v_barcode text;
  v_final_barcode text;
  v_match uuid;
  v_same_name integer;
  v_was_active boolean;
  v_matched uuid[] := '{}';
  v_imported integer := 0;
  v_removed integer := 0;
  v_added integer := 0;
  v_restored integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can import products';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'An import needs at least one product';
  end if;
  if jsonb_array_length(p_rows) > 20000 then
    raise exception 'An import can have at most 20,000 products';
  end if;
  -- A name can repeat in the file only when every row with it has a barcode.
  if exists (
    select 1 from jsonb_array_elements(p_rows) as item
    group by lower(public.normalize_product_name(item ->> 'name'))
    having count(*) > 1
       and bool_or(nullif(regexp_replace(coalesce(item ->> 'barcode', ''), '\s', '', 'g'), '') is null)
  ) then
    raise exception 'A product name appears more than once in the import without barcodes to tell the rows apart';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) as item
    where nullif(regexp_replace(coalesce(item ->> 'barcode', ''), '\s', '', 'g'), '') is not null
    group by regexp_replace(item ->> 'barcode', '\s', '', 'g') having count(*) > 1
  ) then
    raise exception 'Each barcode can appear only once in an import';
  end if;

  for v_row in select item from jsonb_array_elements(p_rows) as item
  loop
    v_name := public.normalize_product_name(v_row ->> 'name');
    v_barcode := nullif(regexp_replace(coalesce(v_row ->> 'barcode', ''), '\s', '', 'g'), '');
    if v_name = '' or coalesce(btrim(v_row ->> 'category'), '') = '' then
      raise exception 'Every product needs a name and a category';
    end if;

    v_match := null;
    if v_barcode is not null then
      select id into v_match from public.products where active and barcode = v_barcode;
      if v_match is null then
        select id into v_match from public.products where active and barcode is null and lower(name) = lower(v_name);
      end if;
      if v_match is null then
        select id into v_match from public.products where not active and barcode = v_barcode order by updated_at desc limit 1;
      end if;
      if v_match is null then
        select id into v_match from public.products where not active and barcode is null and lower(name) = lower(v_name) order by updated_at desc limit 1;
      end if;
    else
      select count(*) into v_same_name from public.products where active and lower(name) = lower(v_name);
      if v_same_name > 1 then
        raise exception 'Several products are named “%”. Add the barcode to that row to say which one', v_name;
      end if;
      select id into v_match from public.products where active and lower(name) = lower(v_name);
      if v_match is null then
        select id into v_match from public.products where not active and lower(name) = lower(v_name) order by updated_at desc limit 1;
      end if;
    end if;

    if v_match is not null and v_match = any (v_matched) then
      raise exception 'Two rows in the import are the same product (“%”)', v_name;
    end if;

    -- The barcode the product will have after this row.
    v_final_barcode := case
      when v_row ? 'barcode' or v_match is null then v_barcode
      else (select barcode from public.products where id = v_match)
    end;
    if v_final_barcode is null and exists (
      select 1 from public.products where active and barcode is null and lower(name) = lower(v_name) and id is distinct from v_match
    ) then
      raise exception 'Another product named “%” has no barcode. Give one of them a barcode or a different name', v_name;
    end if;
    if v_final_barcode is not null and exists (
      select 1 from public.products where active and barcode = v_final_barcode and id is distinct from v_match
    ) then
      raise exception 'The barcode % (“%”) is already used by another product', v_final_barcode, v_name;
    end if;

    if v_match is null then
      insert into public.products (name, category, price, stock, image_icon, active, cost_price, cost_price_known, wholesale_price, barcode)
      values (
        v_name,
        btrim(v_row ->> 'category'),
        (v_row ->> 'price')::numeric,
        (v_row ->> 'stock')::integer,
        coalesce(nullif(v_row ->> 'image_icon', ''), 'auto'),
        true,
        coalesce((v_row ->> 'cost_price')::numeric, 0),
        v_row ? 'cost_price',
        coalesce((v_row ->> 'wholesale_price')::numeric, 0),
        v_barcode
      )
      returning id into v_match;
      v_added := v_added + 1;
    else
      select active into v_was_active from public.products where id = v_match;
      update public.products set
        name = v_name,
        category = btrim(v_row ->> 'category'),
        price = (v_row ->> 'price')::numeric,
        stock = (v_row ->> 'stock')::integer,
        image_icon = coalesce(nullif(v_row ->> 'image_icon', ''), 'auto'),
        active = true,
        cost_price = case when v_row ? 'cost_price' then coalesce((v_row ->> 'cost_price')::numeric, 0) else cost_price end,
        cost_price_known = case when v_row ? 'cost_price' then true else cost_price_known end,
        wholesale_price = case when v_row ? 'wholesale_price' then coalesce((v_row ->> 'wholesale_price')::numeric, 0) else wholesale_price end,
        barcode = v_final_barcode,
        updated_at = now()
      where id = v_match;
      if not v_was_active then
        v_restored := v_restored + 1;
      end if;
    end if;
    v_matched := v_matched || v_match;
    v_imported := v_imported + 1;
  end loop;

  if p_replace then
    update public.products
      set active = false, updated_at = now()
      where active and not (id = any (v_matched));
    get diagnostics v_removed = row_count;
  end if;

  return query select v_imported, v_removed, v_added, v_restored;
end;
$$;

revoke all on function public.import_products(jsonb, boolean) from public, anon;
grant execute on function public.import_products(jsonb, boolean) to authenticated;
