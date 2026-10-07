-- Brings a database set up with an earlier platform.sql up to date.
-- Safe to run more than once. Not needed on a fresh install: platform.sql has it all.
--
-- Lifetime plans: a plan with period_months = 0 never ends; recording its
-- payment clears the shop's paid-until date.
-- Free trials: shops.trial marks a shop whose paid_until is a trial end. The
-- first payment ends the trial, and paid time starts from that day.

alter table plans drop constraint if exists plans_period_months_check;
alter table plans add constraint plans_period_months_check check (period_months >= 0);

alter table shops add column if not exists trial boolean not null default false;

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
    next_until := case when s.trial then now() else greatest(coalesce(s.paid_until, now()), now()) end
      + make_interval(months => p.period_months * periods);
  end if;

  insert into subscription_payments
    (store_id, shop_name, plan_id, amount, currency, method, reference, periods, recorded_by)
  values (store, s.name, plan, amount, p.currency, method, nullif(reference, ''), periods, auth.uid());

  update shops set paid_until = next_until, plan_id = plan, trial = false where store_id = store;
  return next_until;
end $$;
