import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SubjectProfile } from "@/domain/campaigns/schemas";
import {
  createSubjectRouteHandlers,
  type SubjectRouteHandlerDependencies,
} from "@/modules/campaigns/application/subject-route-handlers";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const SUBJECT_ID = "20000000-0000-4000-8000-000000000002";
const CORRELATION_ID = "30000000-0000-4000-8000-000000000003";

const context = vi.fn();
const list = vi.fn();
const create = vi.fn();
const draft = vi.fn();
const edit = vi.fn();
const confirm = vi.fn();
const archive = vi.fn();

const profile: SubjectProfile = {
  id: SUBJECT_ID,
  organizationId: ORGANIZATION_ID,
  name: "Kerala fish curry",
  slug: "kerala-fish-curry",
  description: "Kingfish in a brick-red tamarind and coconut gravy.",
  tags: ["fish curry", "കേരളം"],
  namesByScript: { Latn: "Kerala fish curry", Mlym: "കേരള മീൻ കറി" },
  mustNotAppear: ["naan"],
  illustratedStyle: false,
  state: "draft",
  confirmedBy: null,
  confirmedAt: null,
  createdBy: "40000000-0000-4000-8000-000000000004",
  createdAt: "2026-08-25T10:00:00.000Z",
  updatedAt: "2026-08-25T10:00:00.000Z",
  archivedAt: null,
};

const content = {
  name: profile.name,
  slug: profile.slug,
  description: profile.description,
  tags: profile.tags,
  namesByScript: profile.namesByScript,
  mustNotAppear: profile.mustNotAppear,
  illustratedStyle: profile.illustratedStyle,
};

function dependencies(): SubjectRouteHandlerDependencies {
  return {
    context,
    serviceFor: () => ({ list, create, draft, edit, confirm, archive }),
  } as unknown as SubjectRouteHandlerDependencies;
}

function params(overrides: Record<string, string> = {}) {
  return Promise.resolve({ organizationId: ORGANIZATION_ID, ...overrides });
}

function jsonRequest(method: string, body: unknown, path = "/subjects") {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-correlation-id": CORRELATION_ID,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  for (const mock of [context, list, create, draft, edit, confirm, archive]) mock.mockReset();
  context.mockResolvedValue({
    organizationId: ORGANIZATION_ID,
    user: { id: "user-1" },
    supabase: {},
    membership: { role: "operator" },
  });
  list.mockResolvedValue([profile]);
  create.mockResolvedValue({ subjectProfileId: SUBJECT_ID, state: "draft", created: true });
  draft.mockResolvedValue({ subjectProfileId: SUBJECT_ID, state: "draft", created: true });
  edit.mockResolvedValue({ subjectProfileId: SUBJECT_ID, state: "draft", created: false });
  confirm.mockResolvedValue({
    subjectProfileId: SUBJECT_ID,
    state: "confirmed",
    confirmedAt: "2026-08-25T11:00:00.000Z",
    replayed: false,
  });
  archive.mockResolvedValue({ subjectProfileId: SUBJECT_ID, state: "draft", created: false });
});

describe("subject profile reads", () => {
  it("checks asset.read before returning the session-visible profiles", async () => {
    const response = await createSubjectRouteHandlers(dependencies()).list(
      new Request("http://localhost/subjects", {
        headers: { "x-correlation-id": CORRELATION_ID },
      }),
      params(),
    );

    expect(response.status).toBe(200);
    expect(context).toHaveBeenCalledWith(expect.any(Promise), "asset.read");
    expect(list).toHaveBeenCalledWith(ORGANIZATION_ID);
    expect(response.headers.get("x-correlation-id")).toBe(CORRELATION_ID);
    await expect(response.json()).resolves.toEqual({ subjects: [profile] });
  });
});

describe("subject profile creation", () => {
  it("creates a manual draft without invoking the model", async () => {
    const response = await createSubjectRouteHandlers(dependencies()).create(
      jsonRequest("POST", content),
      params(),
    );

    expect(response.status).toBe(201);
    expect(context).toHaveBeenCalledWith(expect.any(Promise), "subject.manage");
    expect(create).toHaveBeenCalledWith({ organizationId: ORGANIZATION_ID, ...content });
    expect(draft).not.toHaveBeenCalled();
  });

  it("drafts from Business Memory only when the operator asks for it", async () => {
    const { description: _description, ...draftable } = content;
    const response = await createSubjectRouteHandlers(dependencies()).create(
      jsonRequest("POST", {
        ...draftable,
        draftDescription: true,
        operatorNotes: "Served in our red clay pot.",
      }),
      params(),
    );

    expect(response.status).toBe(201);
    expect(draft).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      correlationId: CORRELATION_ID,
      ...draftable,
      operatorNotes: "Served in our red clay pot.",
    });
    expect(create).not.toHaveBeenCalled();
    expect(response.headers.get("x-correlation-id")).toBe(CORRELATION_ID);
  });

  it("authorizes before parsing malformed JSON", async () => {
    context.mockRejectedValue(new Error("context first"));
    const request = new Request("http://localhost/subjects", { method: "POST", body: "{" });

    await createSubjectRouteHandlers(dependencies()).create(request, params());

    expect(context).toHaveBeenCalledWith(expect.any(Promise), "subject.manage");
    expect(create).not.toHaveBeenCalled();
  });
});

describe("subject profile changes", () => {
  it("edits content through the governed upsert", async () => {
    const response = await createSubjectRouteHandlers(dependencies()).update(
      jsonRequest("PATCH", { action: "edit", ...content }),
      params({ subjectId: SUBJECT_ID }),
    );

    expect(response.status).toBe(200);
    expect(edit).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      subjectProfileId: SUBJECT_ID,
      ...content,
    });
  });

  it("uses the distinct confirmation operation", async () => {
    // Confirming is separately permissioned, so this case needs a confirming
    // role. The refusal for a merely managing role is covered below.
    context.mockResolvedValue({
      organizationId: ORGANIZATION_ID,
      user: { id: "user-1" },
      supabase: {},
      membership: { role: "owner" },
    });

    const response = await createSubjectRouteHandlers(dependencies()).update(
      jsonRequest("PATCH", { action: "confirm" }),
      params({ subjectId: SUBJECT_ID }),
    );

    expect(context).toHaveBeenCalledWith(expect.any(Promise), "subject.manage");
    expect(confirm).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      subjectProfileId: SUBJECT_ID,
    });
    expect(edit).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it("archives without accepting replacement profile content", async () => {
    await createSubjectRouteHandlers(dependencies()).update(
      jsonRequest("PATCH", { action: "archive" }),
      params({ subjectId: SUBJECT_ID }),
    );

    expect(archive).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      subjectProfileId: SUBJECT_ID,
    });
  });

  it("rejects an invalid subject ID before calling a mutation", async () => {
    const response = await createSubjectRouteHandlers(dependencies()).update(
      jsonRequest("PATCH", { action: "confirm" }),
      params({ subjectId: "not-a-uuid" }),
    );

    expect(response.status).toBe(400);
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe("confirmation is the privileged act", () => {
  it("refuses to confirm for a role that may still draft and edit", async () => {
    context.mockResolvedValue({
      organizationId: ORGANIZATION_ID,
      user: { id: "user-1" },
      supabase: {},
      membership: { role: "operator" },
    });

    const response = await createSubjectRouteHandlers(dependencies()).update(
      jsonRequest("PATCH", { action: "confirm" }, `/subjects/${SUBJECT_ID}`),
      params({ subjectId: SUBJECT_ID }),
    );

    expect(response.status).toBe(403);
    expect(confirm).not.toHaveBeenCalled();
    expect(response.headers.get("x-correlation-id")).toBe(CORRELATION_ID);
  });

  it("still lets that same role edit and archive", async () => {
    const handlers = createSubjectRouteHandlers(dependencies());

    const edited = await handlers.update(
      jsonRequest("PATCH", { action: "edit", ...content }, `/subjects/${SUBJECT_ID}`),
      params({ subjectId: SUBJECT_ID }),
    );
    const archived = await handlers.update(
      jsonRequest("PATCH", { action: "archive" }, `/subjects/${SUBJECT_ID}`),
      params({ subjectId: SUBJECT_ID }),
    );

    expect(edited.status).toBe(200);
    expect(archived.status).toBe(200);
    expect(edit).toHaveBeenCalledOnce();
    expect(archive).toHaveBeenCalledOnce();
  });

  it("confirms for a role the organization trusts with the privileged act", async () => {
    context.mockResolvedValue({
      organizationId: ORGANIZATION_ID,
      user: { id: "user-1" },
      supabase: {},
      membership: { role: "admin" },
    });

    const response = await createSubjectRouteHandlers(dependencies()).update(
      jsonRequest("PATCH", { action: "confirm" }, `/subjects/${SUBJECT_ID}`),
      params({ subjectId: SUBJECT_ID }),
    );

    expect(response.status).toBe(200);
    expect(confirm).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      subjectProfileId: SUBJECT_ID,
    });
  });
});
