alter table public.products
  add column if not exists image_icon text not null default 'auto',
  add column if not exists image_url text;

alter table public.products
  drop constraint if exists products_image_icon_check;

alter table public.products
  add constraint products_image_icon_check
  check (image_icon in (
    'auto',
    'rice',
    'canned',
    'noodles',
    'snacks',
    'eggs',
    'drink',
    'coffee',
    'condiments',
    'personal-care',
    'household',
    'bread',
    'candy',
    'frozen',
    'medicine'
  ));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Product images are publicly readable" on storage.objects;
create policy "Product images are publicly readable"
  on storage.objects for select
  using (bucket_id = 'product-images');

drop policy if exists "Admins can upload product images" on storage.objects;
create policy "Admins can upload product images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'product-images'
    and (select public.is_admin())
  );

drop policy if exists "Admins can delete product images" on storage.objects;
create policy "Admins can delete product images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'product-images'
    and (select public.is_admin())
  );
