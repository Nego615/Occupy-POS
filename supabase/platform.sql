-- Platform owner dashboard: shops, plans and subscriptions.
-- Run once in the Supabase SQL editor, after sync.sql.
--
-- Setup:
--   1. Run this file.
--   2. Create your own vendor login under Authentication → Users, then make it
--      a platform admin (the last statement in this file, uncommented).
--   3. In Vercel, set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (server only —
--      never VITE_-prefixed) and optionally VITE_SUPPORT_CONTACT, shown to a
--      shop whose register is locked.
--   4. Sign in at /platform. To try the api/ functions locally, use `vercel dev`.

-- Who may run the platform. Not a shop: these accounts never hold POS data.
create table platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table platform_admins enable row level security;

create function is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;

create policy "admins read admins" on platform_admins
  for select using (is_platform_admin());

-- What a shop pays, and how often. Plans don't gate features.
-- period_months = 0 is a lifetime plan: paid once, never ends.
create table plans (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  price         numeric not null check (price >= 0),
  currency      text not null default 'TZS',
  period_months int not null default 1 check (period_months >= 0),
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
alter table plans enable row level security;
create policy "signed-in read plans" on plans
  for select using (auth.uid() is not null);
create policy "admins write plans" on plans
  for all using (is_platform_admin()) with check (is_platform_admin());

-- One row per shop account. The shop can read its own row, which is how the
-- register knows whether it's paid up; only admins change it.
create table shops (
  store_id    uuid primary key references auth.users(id) on delete cascade,
  name        text not null,
  owner_email text not null,
  phone       text,
  notes       text,
  plan_id     uuid references plans(id),
  paid_until  timestamptz,
  grace_days  int not null default 7 check (grace_days >= 0),
  suspended   boolean not null default false,
  created_at  timestamptz not null default now()
);
alter table shops enable row level security;
create policy "shop reads itself" on shops
  for select using (store_id = auth.uid() or is_platform_admin());
create policy "admins write shops" on shops
  for all using (is_platform_admin()) with check (is_platform_admin());

-- Payments taken by hand (M-Pesa, bank, cash). The shop's name is copied in
-- so the ledger still reads after the shop is deleted.
create table subscription_payments (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid references auth.users(id) on delete set null,
  shop_name   text not null,
  plan_id     uuid references plans(id),
  amount      numeric not null check (amount >= 0),
  currency    text not null,
  method      text not null,
  reference   text,
  periods     int not null check (periods > 0),
  paid_at     timestamptz not null default now(),
  recorded_by uuid references auth.users(id) on delete set null
);
create index subscription_payments_store on subscription_payments (store_id, paid_at desc);
alter table subscription_payments enable row level security;
create policy "admins manage payments" on subscription_payments
  for all using (is_platform_admin()) with check (is_platform_admin());

-- Records a payment and extends the shop by whole plan periods, counted from
-- whichever is later: today, or the date it's already paid up to. A lifetime
-- plan clears the end date instead, and counts as one period.
create or replace function record_payment(
  store uuid, plan uuid, amount numeric, method text, reference text, periods int
) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  p plans;
  s shops;
  next_until timestamptz;
begin
  if not is_platform_admin() then raise exception 'not a platform admin'; end if;
  select * into p from plans where id = plan;
  if not found then raise exception 'no such plan'; end if;
  select * into s from shops where store_id = store for update;
  if not found then raise exception 'no such shop'; end if;
  if periods < 1 then raise exception 'periods must be at least 1'; end if;

  if p.period_months = 0 then
    next_until := null;
    periods := 1;
  else
    next_until := greatest(coalesce(s.paid_until, now()), now())
      + make_interval(months => p.period_months * periods);
  end if;

  insert into subscription_payments
    (store_id, shop_name, plan_id, amount, currency, method, reference, periods, recorded_by)
  values (store, s.name, plan, amount, p.currency, method, nullif(reference, ''), periods, auth.uid());

  update shops set paid_until = next_until, plan_id = plan where store_id = store;
  return next_until;
end $$;

-- How much each shop uses the register, without letting admins read any
-- shop's records.
create function platform_shop_stats()
returns table (store_id uuid, last_activity timestamptz, orders bigint, staff bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not a platform admin'; end if;
  return query
    select r.store_id,
           max(r.updated_at),
           count(*) filter (where r.collection = 'orders' and not r.deleted),
           count(*) filter (where r.collection = 'staff' and not r.deleted
                            and coalesce((r.value ->> 'deleted')::boolean, false) = false)
    from pos_records r
    group by r.store_id;
end $$;

-- Shops already using the register get a row and 30 days to settle up.
insert into shops (store_id, name, owner_email, paid_until)
select u.id,
       coalesce(
         (select value ->> 'businessName' from pos_records
           where store_id = u.id and collection = 'settings' and id = '_'),
         u.email),
       u.email,
       now() + interval '30 days'
from auth.users u
where exists (select 1 from pos_records r where r.store_id = u.id)
  and not exists (select 1 from platform_admins a where a.user_id = u.id)
on conflict do nothing;

-- Make yourself a platform admin (your user id is under Authentication → Users):
-- insert into platform_admins (user_id) values ('00000000-0000-0000-0000-000000000000');
