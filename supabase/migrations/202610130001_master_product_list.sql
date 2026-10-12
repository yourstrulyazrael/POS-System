-- Master list import: the imported file becomes the complete product list.
--
-- In one transaction: every active product not named in the file is removed
-- (active = false, like the Remove button, so past orders keep their product),
-- then every row is added or updated by name. If anything fails, nothing
-- changes. Removing first frees the barcodes of removed products for reuse.
--
-- p_rows: [{ name, category, price, stock, image_icon,
--            cost_price?, wholesale_price?, barcode? }]
-- A missing optional key keeps the product's current value (same as a normal
-- import); a previously removed product named in the file is restored.
create or replace function public.import_master_product_list(p_rows jsonb)
returns table (imported integer, removed integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_removed integer;
  v_imported integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can replace the product list';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'A master list needs at least one product';
  end if;
  if jsonb_array_length(p_rows) > 20000 then
    raise exception 'A master list can have at most 20,000 products';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) as item
    group by item ->> 'name' having count(*) > 1
  ) then
    raise exception 'Each product name can appear only once in the master list';
  end if;

  update public.products
    set active = false, updated_at = now()
    where active
      and name not in (select item ->> 'name' from jsonb_array_elements(p_rows) as item);
  get diagnostics v_removed = row_count;

  for v_row in select item from jsonb_array_elements(p_rows) as item
  loop
    if coalesce(btrim(v_row ->> 'name'), '') = '' or coalesce(btrim(v_row ->> 'category'), '') = '' then
      raise exception 'Every product needs a name and a category';
    end if;

    insert into public.products (name, category, price, stock, image_icon, active, cost_price, cost_price_known, wholesale_price, barcode)
    values (
      v_row ->> 'name',
      v_row ->> 'category',
      (v_row ->> 'price')::numeric,
      (v_row ->> 'stock')::integer,
      coalesce(nullif(v_row ->> 'image_icon', ''), 'auto'),
      true,
      coalesce((v_row ->> 'cost_price')::numeric, 0),
      v_row ? 'cost_price',
      coalesce((v_row ->> 'wholesale_price')::numeric, 0),
      nullif(v_row ->> 'barcode', '')
    )
    on conflict (name) do update set
      category = excluded.category,
      price = excluded.price,
      stock = excluded.stock,
      image_icon = excluded.image_icon,
      active = true,
      cost_price = case when v_row ? 'cost_price' then excluded.cost_price else products.cost_price end,
      cost_price_known = case when v_row ? 'cost_price' then true else products.cost_price_known end,
      wholesale_price = case when v_row ? 'wholesale_price' then excluded.wholesale_price else products.wholesale_price end,
      barcode = case when v_row ? 'barcode' then excluded.barcode else products.barcode end,
      updated_at = now();
    v_imported := v_imported + 1;
  end loop;

  return query select v_imported, v_removed;
end;
$$;

revoke all on function public.import_master_product_list(jsonb) from public, anon;
grant execute on function public.import_master_product_list(jsonb) to authenticated;
