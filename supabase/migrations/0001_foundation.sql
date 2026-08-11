-- 0001_foundation.sql
-- Extensions, shared enums, and the updated_at touch trigger.
-- SSC Training Log — data foundation.

create extension if not exists "pgcrypto";      -- gen_random_uuid()
create extension if not exists "citext";        -- case-insensitive text (emails, exercise names)

-- ---------------------------------------------------------------------------
-- Shared enums
-- ---------------------------------------------------------------------------
create type ssc_sex as enum ('male', 'female');

-- How an exercise row expresses target intensity.
create type ssc_intensity_type as enum ('rpe', 'percent', 'relative');

create type ssc_program_status as enum ('draft', 'published', 'archived');

create type ssc_weekday as enum
  ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun');

create type ssc_competition_level as enum ('international', 'national');

create type ssc_competition_status as enum ('invited', 'opted_in', 'opted_out');

create type ssc_order_status as enum ('pending', 'fulfilled', 'cancelled');

-- Resource kinds a coach can share with another coach. Deliberately generic:
-- a future nutrition module adds 'nutrition_plan' here without a redesign.
create type ssc_share_resource as enum ('athlete', 'program');

-- ---------------------------------------------------------------------------
-- updated_at touch trigger — reused across mutable tables.
-- ---------------------------------------------------------------------------
create or replace function ssc_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
