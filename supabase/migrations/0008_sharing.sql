-- 0008_sharing.sql
-- Opt-in, per-item sharing. A coach grants another coach edit access to one
-- specific athlete or program. Deliberately generic (resource_type enum) so a
-- future nutrition module shares through the same table.

create table coach_shares (
  id                   uuid primary key default gen_random_uuid(),
  resource_type        ssc_share_resource not null,
  resource_id          uuid not null,
  shared_with_coach_id uuid not null references coaches (id) on delete cascade,
  granted_by_coach_id  uuid not null references coaches (id) on delete cascade,
  created_at           timestamptz not null default now(),
  unique (resource_type, resource_id, shared_with_coach_id),
  check (shared_with_coach_id <> granted_by_coach_id)
);

create index coach_shares_lookup_idx
  on coach_shares (resource_type, resource_id);
create index coach_shares_grantee_idx
  on coach_shares (shared_with_coach_id);
