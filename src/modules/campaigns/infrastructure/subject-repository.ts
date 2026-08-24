import { subjectProfileSchema, type SubjectProfile } from "@/domain/campaigns/schemas";
import {
  subjectConfirmationResultSchema,
  subjectMutationResultSchema,
  type SubjectProfileStore,
} from "@/modules/campaigns/application/subject-service";

type PersistenceResult<T> = { data: T | null; error: { code?: string } | null };

type SubjectQuery = {
  select(columns: string): SubjectQuery;
  eq(column: string, value: string): SubjectQuery;
  is(column: string, value: null): SubjectQuery;
  order(column: string, options: { ascending: boolean }): Promise<PersistenceResult<unknown>>;
  maybeSingle(): Promise<PersistenceResult<unknown>>;
};

export type SubjectPersistence = {
  from(table: "organization_subject_profiles"): SubjectQuery;
  rpc(
    name: "upsert_subject_profile" | "confirm_subject_profile",
    args: Record<string, unknown>,
  ): Promise<PersistenceResult<unknown>>;
};

const SUBJECT_COLUMNS = [
  "id",
  "organization_id",
  "name",
  "slug",
  "description",
  "tags",
  "names_by_script",
  "must_not_appear",
  "illustrated_style",
  "state",
  "confirmed_by",
  "confirmed_at",
  "created_by",
  "created_at",
  "updated_at",
  "archived_at",
].join(",");

function subjectPersistenceError(): never {
  throw new Error("The subject profile could not be changed or read.");
}

function subjectMutationError(): never {
  throw new Error("The subject profile could not be changed.");
}

function canonicalUtc(value: unknown): unknown {
  if (value === null || typeof value !== "string") return value;
  const milliseconds = Date.parse(value);
  return Number.isNaN(milliseconds) ? value : new Date(milliseconds).toISOString();
}

function mapSubjectRow(value: unknown): SubjectProfile {
  const row = value as Record<string, unknown>;
  const parsed = subjectProfileSchema.safeParse({
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    tags: row.tags,
    namesByScript: row.names_by_script,
    mustNotAppear: row.must_not_appear,
    illustratedStyle: row.illustrated_style,
    state: row.state,
    confirmedBy: row.confirmed_by,
    confirmedAt: canonicalUtc(row.confirmed_at),
    createdBy: row.created_by,
    createdAt: canonicalUtc(row.created_at),
    updatedAt: canonicalUtc(row.updated_at),
    archivedAt: canonicalUtc(row.archived_at),
  });
  if (!parsed.success) subjectPersistenceError();
  return parsed.data;
}

export function createSubjectRepository(persistence: SubjectPersistence): SubjectProfileStore {
  return {
    async list(organizationId) {
      const { data, error } = await persistence
        .from("organization_subject_profiles")
        .select(SUBJECT_COLUMNS)
        .eq("organization_id", organizationId)
        .is("archived_at", null)
        .order("name", { ascending: true });
      if (error || !Array.isArray(data)) subjectPersistenceError();
      return data.map(mapSubjectRow);
    },

    async get(organizationId, subjectProfileId) {
      const { data, error } = await persistence
        .from("organization_subject_profiles")
        .select(SUBJECT_COLUMNS)
        .eq("organization_id", organizationId)
        .eq("id", subjectProfileId)
        .maybeSingle();
      if (error) subjectPersistenceError();
      return data === null ? null : mapSubjectRow(data);
    },

    async upsert(input) {
      const inputProfile = {
        organization_id: input.organizationId,
        subject_profile_id: input.subjectProfileId,
        name: input.name,
        slug: input.slug,
        description: input.description,
        tags: input.tags,
        names_by_script: input.namesByScript,
        must_not_appear: input.mustNotAppear,
        illustrated_style: input.illustratedStyle,
        ...(input.archived === undefined ? {} : { archived: input.archived }),
      };
      const { data, error } = await persistence.rpc("upsert_subject_profile", {
        target_organization_id: input.organizationId,
        input_profile: inputProfile,
      });
      if (error || !data) subjectMutationError();

      const raw = data as Record<string, unknown>;
      const parsed = subjectMutationResultSchema.safeParse({
        subjectProfileId: raw.subject_profile_id,
        state: raw.state,
        created: raw.created,
      });
      if (!parsed.success) subjectMutationError();
      return parsed.data;
    },

    async confirm(input) {
      const { data, error } = await persistence.rpc("confirm_subject_profile", {
        target_organization_id: input.organizationId,
        input_confirmation: {
          organization_id: input.organizationId,
          subject_profile_id: input.subjectProfileId,
        },
      });
      if (error || !data) subjectMutationError();

      const raw = data as Record<string, unknown>;
      const parsed = subjectConfirmationResultSchema.safeParse({
        subjectProfileId: raw.subject_profile_id,
        state: raw.state,
        confirmedAt: canonicalUtc(raw.confirmed_at),
        replayed: raw.replayed,
      });
      if (!parsed.success) subjectMutationError();
      return parsed.data;
    },
  };
}
