-- Product names and barcodes: catching duplicates.
--
-- * Names are tidied when saved (no spaces at the ends, single spaces
--   inside), and must be unique ignoring capitals, among products still for
--   sale. A removed product no longer blocks its name.
-- * Barcodes are stored without spaces (as the app already saves them).
-- * Imports find existing products by barcode first, then by name (ignoring
--   capitals), and restore a removed product with the same name or barcode,
--   so renaming a product in a spreadsheet updates it instead of adding a
--   second one.
--
-- Existing products whose names only differ in capitals or spacing are kept:
-- the oldest keeps its name, the others get " (2)", " (3)"… added so they can
-- be told apart (rename or remove them in Inventory).

alter table public.products drop constraint if exists products_name_key;

create or replace function public.normalize_product_name(p_name text)
returns text
language sql
immutable
as $$
  select regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
$$;

create or replace function public.products_normalize()
returns trigger
language plpgsql
as $$
begin
  new.name := public.normalize_product_name(new.name);
  if new.name = '' then
    raise exception 'A product needs a name';
  end if;
  if new.barcode is not null then
    new.barcode := nullif(regexp_replace(new.barcode, '\s', '', 'g'), '');
  end if;
  return new;
end;
$$;

drop trigger if exists products_normalize on public.products;
create trigger products_normalize
  before insert or update of name, barcode on public.products
  for each row execute function public.products_normalize();

-- Tidy existing names and barcodes (the trigger does the work).
update public.products
  set name = name, barcode = barcode
  where name <> public.normalize_product_name(name)
     or (barcode is not null and barcode ~ '\s');

-- Products still for sale whose names differ only in capitals: number them.
with ranked as (
  select id, row_number() over (partition by lower(name) order by created_at, id) as position
  from public.products
  where active
)
update public.products
  set name = left(products.name, 110) || ' (' || ranked.position || ')', updated_at = now()
  from ranked
  where products.id = ranked.id and ranked.position > 1;

create unique index if not exists products_active_name_key
  on public.products (lower(name))
  where active;

-- ---------------------------------------------------------------------------
-- Imports. p_rows: [{ name, category, price, stock, image_icon,
--                     cost_price?, wholesale_price?, barcode? }]
-- A missing optional key keeps the product's current value. Each row updates
-- the product with the same barcode, else the same name (ignoring capitals),
-- else restores a removed product with that name or barcode, else adds a
-- new product. With p_replace (master list), products for sale that no row
-- matched are removed afterwards. All or nothing.
-- ---------------------------------------------------------------------------
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
  v_match uuid;
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
  if exists (
    select 1 from jsonb_array_elements(p_rows) as item
    group by lower(public.normalize_product_name(item ->> 'name')) having count(*) > 1
  ) then
    raise exception 'Each product name can appear only once in an import';
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
    -- 1. Same barcode, for sale. 2. Same name, for sale.
    if v_barcode is not null then
      select id into v_match from public.products where active and barcode = v_barcode;
    end if;
    if v_match is null then
      select id into v_match from public.products where active and lower(name) = lower(v_name);
    end if;
    -- 3. A removed product with that name, else that barcode (newest first).
    if v_match is null then
      select id into v_match from public.products
        where not active and lower(name) = lower(v_name)
        order by updated_at desc limit 1;
    end if;
    if v_match is null and v_barcode is not null then
      select id into v_match from public.products
        where not active and barcode = v_barcode
        order by updated_at desc limit 1;
    end if;

    if v_match is not null and v_match = any (v_matched) then
      raise exception 'Two rows in the import are the same product (“%” has the same name or barcode as another row)', v_name;
    end if;
    if exists (select 1 from public.products where active and lower(name) = lower(v_name) and id is distinct from v_match) then
      raise exception 'The name “%” is already used by another product', v_name;
    end if;
    if v_barcode is not null and exists (select 1 from public.products where active and barcode = v_barcode and id is distinct from v_match) then
      raise exception 'The barcode % (“%”) is already used by another product', v_barcode, v_name;
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
        barcode = case when v_row ? 'barcode' then v_barcode else barcode end,
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

-- Kept for app versions before 1.2.2 (master list import).
create or replace function public.import_master_product_list(p_rows jsonb)
returns table (imported integer, removed integer)
language sql
security definer
set search_path = public
as $$
  select result.imported, result.removed from public.import_products(p_rows, true) as result;
$$;

revoke all on function public.import_master_product_list(jsonb) from public, anon;
grant execute on function public.import_master_product_list(jsonb) to authenticated;
