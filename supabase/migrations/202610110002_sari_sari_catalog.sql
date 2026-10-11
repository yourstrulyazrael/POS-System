update public.products
set active = false, updated_at = now()
where (name, category) in (
  ('Cappuccino', 'Coffee'),
  ('Iced Matcha Latte', 'Cold Drinks'),
  ('Butter Croissant', 'Bakery'),
  ('Vanilla Cold Brew', 'Cold Drinks'),
  ('Blueberry Muffin', 'Bakery'),
  ('Honey Oat Latte', 'Coffee'),
  ('Chamomile Tea', 'Tea'),
  ('Avocado Toast', 'Bakery'),
  ('Strawberry Lemonade', 'Cold Drinks')
);

insert into public.products (name, category, price, stock) values
  ('Sinandomeng Rice (1 kg)', 'Rice & Grains', 65.00, 40),
  ('Sardines (155 g)', 'Canned Goods', 25.00, 30),
  ('Corned Beef (150 g)', 'Canned Goods', 38.00, 24),
  ('Pancit Canton', 'Instant Noodles', 15.00, 36),
  ('Cup Noodles', 'Instant Noodles', 32.00, 18),
  ('Potato Chips', 'Snacks', 20.00, 25),
  ('SkyFlakes Crackers', 'Snacks', 12.00, 30),
  ('Bottled Water', 'Beverages', 15.00, 24),
  ('Cola (Small Bottle)', 'Beverages', 25.00, 20),
  ('3-in-1 Coffee Sachet', 'Coffee & Drinks', 12.00, 40),
  ('Powdered Juice Sachet', 'Coffee & Drinks', 10.00, 30),
  ('Soy Sauce (Small Bottle)', 'Condiments', 18.00, 18),
  ('Cooking Oil (250 ml)', 'Condiments', 35.00, 16),
  ('Shampoo Sachet', 'Personal Care', 8.00, 40),
  ('Bath Soap', 'Personal Care', 25.00, 20),
  ('Laundry Detergent Sachet', 'Household', 10.00, 36),
  ('Fresh Eggs (piece)', 'Eggs & Dairy', 10.00, 30)
on conflict (name) do nothing;
