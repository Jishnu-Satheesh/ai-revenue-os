import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createSubjectRepository,
  type SubjectPersistence,
} from "@/modules/campaigns/infrastructure/subject-repository";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const SUBJECT_ID = "20000000-0000-4000-8000-000000000002";

const row = {
  id: SUBJECT_ID,
  organization_id: ORGANIZATION_ID,
  name: "Kerala fish curry",
  slug: "kerala-fish-curry",
  description: "Kingfish steaks in a brick-red tamarind and coconut gravy.",
  tags: ["fish curry"],
  names_by_script: { Mlym: "കേരള മീൻ കറി" },
  must_not_appear: ["naan"],
  illustrated_style: false,
  state: "draft",
  confirmed_by: null,
  confirmed_at: null,
  created_by: "30000000-0000-4000-8000-000000000003",
  created_at: "2026-08-24T10:00:00.000Z",
  updated_at: "2026-08-24T10:00:00.000Z",
  archived_at: null,
};

const rpc = vi.fn();
const from = vi.fn();
const select = vi.fn();
const eq = vi.fn();
const is = vi.fn();
const order = vi.fn();
const maybeSingle = vi.fn();

function persistence(): SubjectPersistence {
  const builder = { select, eq, is, order, maybeSingle };
  from.mockReturnValue(builder);
  select.mockReturnValue(builder);
  eq.mockReturnValue(builder);
  is.mockReturnValue(builder);
  return { rpc, from } as unknown as SubjectPersistence;
}

beforeEach(() => {
  for (const mock of [rpc, from, select, eq, is, order, maybeSingle]) mock.mockReset();
});

describe("subject profile session reads", () => {
  it("lists active profiles through the session client and maps the row", async () => {
    order.mockResolvedValue({ data: [row], error: null });
    const repository = createSubjectRepository(persistence());

    const result = await repository.list(ORGANIZATION_ID);

    expect(from).toHaveBeenCalledWith("organization_subject_profiles");
    expect(eq).toHaveBeenCalledWith("organization_id", ORGANIZATION_ID);
    expect(is).toHaveBeenCalledWith("archived_at", null);
    expect(result[0]).toMatchObject({ id: SUBJECT_ID, organizationId: ORGANIZATION_ID });
  });

  it("reads one tenant-scoped profile and returns null when RLS exposes no row", async () => {
    maybeSingle.mockResolvedValueOnce({ data: row, error: null });
    const repository = createSubjectRepository(persistence());

    await expect(repository.get(ORGANIZATION_ID, SUBJECT_ID)).resolves.toMatchObject({
      id: SUBJECT_ID,
    });
    expect(eq).toHaveBeenCalledWith("organization_id", ORGANIZATION_ID);
    expect(eq).toHaveBeenCalledWith("id", SUBJECT_ID);

    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    await expect(repository.get(ORGANIZATION_ID, SUBJECT_ID)).resolves.toBeNull();
  });

  it("fails closed on a malformed database row", async () => {
    order.mockResolvedValue({ data: [{ ...row, state: "published" }], error: null });

    await expect(createSubjectRepository(persistence()).list(ORGANIZATION_ID)).rejects.toThrow();
  });

  it("canonicalizes PostgREST UTC offsets before applying the domain schema", async () => {
    order.mockResolvedValue({
      data: [
        {
          ...row,
          created_at: "2026-08-24T10:00:00+00:00",
          updated_at: "2026-08-24T10:05:00+00:00",
        },
      ],
      error: null,
    });

    const [profile] = await createSubjectRepository(persistence()).list(ORGANIZATION_ID);

    expect(profile?.createdAt).toBe("2026-08-24T10:00:00.000Z");
    expect(profile?.updatedAt).toBe("2026-08-24T10:05:00.000Z");
  });
});

describe("subject profile governed writes", () => {
  it("upserts through the RPC with the organization repeated inside the payload", async () => {
    rpc.mockResolvedValue({
      data: { subject_profile_id: SUBJECT_ID, state: "draft", created: true },
      error: null,
    });
    const repository = createSubjectRepository(persistence());

    const result = await repository.upsert({
      organizationId: ORGANIZATION_ID,
      subjectProfileId: null,
      name: row.name,
      slug: row.slug,
      description: row.description,
      tags: row.tags,
      namesByScript: row.names_by_script,
      mustNotAppear: row.must_not_appear,
      illustratedStyle: false,
      archived: false,
    });

    expect(rpc).toHaveBeenCalledWith("upsert_subject_profile", {
      target_organization_id: ORGANIZATION_ID,
      input_profile: {
        organization_id: ORGANIZATION_ID,
        subject_profile_id: null,
        name: row.name,
        slug: row.slug,
        description: row.description,
        tags: row.tags,
        names_by_script: row.names_by_script,
        must_not_appear: row.must_not_appear,
        illustrated_style: false,
        archived: false,
      },
    });
    expect(result).toEqual({ subjectProfileId: SUBJECT_ID, state: "draft", created: true });
  });

  it("confirms through the separate RPC and parses replay evidence", async () => {
    rpc.mockResolvedValue({
      data: {
        subject_profile_id: SUBJECT_ID,
        state: "confirmed",
        confirmed_at: "2026-08-24T11:00:00.000Z",
        replayed: true,
      },
      error: null,
    });
    const repository = createSubjectRepository(persistence());

    const result = await repository.confirm({
      organizationId: ORGANIZATION_ID,
      subjectProfileId: SUBJECT_ID,
    });

    expect(rpc).toHaveBeenCalledWith("confirm_subject_profile", {
      target_organization_id: ORGANIZATION_ID,
      input_confirmation: {
        organization_id: ORGANIZATION_ID,
        subject_profile_id: SUBJECT_ID,
      },
    });
    expect(result.replayed).toBe(true);
  });

  it("does not leak raw RPC failures", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "subject_profile_forbidden" } });

    await expect(
      createSubjectRepository(persistence()).confirm({
        organizationId: ORGANIZATION_ID,
        subjectProfileId: SUBJECT_ID,
      }),
    ).rejects.toThrow("The subject profile could not be changed");
  });
});
