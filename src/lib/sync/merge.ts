/**
 * Three-way field merge — the client mirror of SQL `ssc_merge3` (0012_sync.sql).
 * Used both to reason about conflicts in tests and to reconcile realtime updates
 * into a locally-dirty record. Keep it byte-for-byte equivalent to the SQL rule.
 *
 *   base   = value the offline edit started from
 *   local  = value the incoming offline edit wants
 *   remote = value currently on the server
 *
 * If this device didn't change the field -> take remote. If the server didn't
 * change it -> take local. If both changed to the same thing -> no conflict.
 * If both changed differently -> conflict; the incoming (local) write wins the
 * row but the remote value is preserved by the caller.
 */
export type Primitive = string | number | boolean | null;

const norm = (v: Primitive | undefined): Primitive => (v === undefined ? null : v);
const eq = (a: Primitive | undefined, b: Primitive | undefined): boolean => norm(a) === norm(b);

export interface FieldMerge {
  value: Primitive;
  conflict: boolean;
}

export function mergeField(
  base: Primitive | undefined,
  local: Primitive | undefined,
  remote: Primitive | undefined,
): FieldMerge {
  if (eq(local, base)) return { value: norm(remote), conflict: false };
  if (eq(remote, base)) return { value: norm(local), conflict: false };
  if (eq(remote, local)) return { value: norm(local), conflict: false };
  return { value: norm(local), conflict: true };
}

export interface RecordConflict {
  field: string;
  base: Primitive;
  local: Primitive;
  remote: Primitive;
}

export interface RecordMerge {
  merged: Record<string, Primitive>;
  conflicts: RecordConflict[];
}

/** Field-by-field three-way merge over a fixed field set. */
export function mergeRecord(
  fields: string[],
  base: Record<string, Primitive> | null,
  local: Record<string, Primitive>,
  remote: Record<string, Primitive>,
): RecordMerge {
  const merged: Record<string, Primitive> = {};
  const conflicts: RecordConflict[] = [];
  for (const f of fields) {
    const m = mergeField(base?.[f], local[f], remote[f]);
    merged[f] = m.value;
    if (m.conflict) {
      conflicts.push({
        field: f,
        base: norm(base?.[f]),
        local: norm(local[f]),
        remote: norm(remote[f]),
      });
    }
  }
  return { merged, conflicts };
}
