-- 0006_shop.sql
-- Webshop: products + variants, orders + line items. No payment processing —
-- orders are requests. All orders route to the head coach (enforced in RLS).

create table products (
  id              uuid primary key default gen_random_uuid(),
  created_by_coach_id uuid references coaches (id) on delete set null,
  name            text not null,
  description     text,
  price_cents     int not null check (price_cents >= 0),
  image_url       text,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index products_active_idx on products (active);

create trigger products_touch
  before update on products
  for each row execute function ssc_touch_updated_at();

-- Optional variant (size / color). Products with no variants are ordered directly.
create table product_variants (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id) on delete cascade,
  label      text not null,               -- e.g. "L" or "Black / L"
  sku        text,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (product_id, label)
);

create index product_variants_product_idx on product_variants (product_id);

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
create table orders (
  id          uuid primary key default gen_random_uuid(),
  athlete_id  uuid not null references athletes (id) on delete cascade,
  status      ssc_order_status not null default 'pending',
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index orders_athlete_idx on orders (athlete_id);
create index orders_status_idx on orders (status);

create trigger orders_touch
  before update on orders
  for each row execute function ssc_touch_updated_at();

create table order_items (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references orders (id) on delete cascade,
  product_id       uuid not null references products (id) on delete restrict,
  variant_id       uuid references product_variants (id) on delete restrict,
  quantity         int not null check (quantity >= 1),
  -- Price captured at order time so later product edits don't rewrite history.
  unit_price_cents int not null check (unit_price_cents >= 0),
  created_at       timestamptz not null default now()
);

create index order_items_order_idx on order_items (order_id);
create index order_items_product_idx on order_items (product_id);
