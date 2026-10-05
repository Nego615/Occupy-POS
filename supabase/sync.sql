-- Multi-screen sync. Run once in the Supabase SQL editor.

-- One row per record (an order, a tab, a menu item, a shift…), so screens
-- editing different records never overwrite each other.
create table pos_records (
  store_id   uuid not null references auth.users(id) on delete cascade,
  collection text not null,
  id         text not null,
  value      jsonb,
  deleted    boolean not null default false,
  seq        bigint generated always as identity,
  updated_at timestamptz not null default now(),
  primary key (store_id, collection, id)
);
create index pos_records_changes on pos_records (store_id, updated_at);

alter table pos_records enable row level security;
create policy "store owns its records" on pos_records
  for all using (store_id = auth.uid()) with check (store_id = auth.uid());

-- The server stamps every write, so screens agree on which version is newest.
create function pos_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end $$;
create trigger pos_records_touch before insert or update on pos_records
  for each row execute function pos_touch();

-- Live updates to every signed-in screen.
alter publication supabase_realtime add table pos_records;

-- Shared counters for order, ticket, PO, bill, payment and count numbers.
create table pos_counters (
  store_id uuid not null references auth.users(id) on delete cascade,
  name     text not null,
  next_id  bigint not null,
  primary key (store_id, name)
);
alter table pos_counters enable row level security;
create policy "store owns its counters" on pos_counters
  for all using (store_id = auth.uid()) with check (store_id = auth.uid());

-- Reserves `how_many` numbers no other screen will get; returns the first.
-- `floor` keeps a new counter above numbers already in use.
create function reserve_ids(counter text, how_many int, floor bigint)
returns bigint language sql security invoker as $$
  insert into pos_counters (store_id, name, next_id)
  values (auth.uid(), counter, greatest(floor, 1) + how_many)
  on conflict (store_id, name)
  do update set next_id = greatest(pos_counters.next_id, excluded.next_id - how_many) + how_many
  returning next_id - how_many;
$$;
