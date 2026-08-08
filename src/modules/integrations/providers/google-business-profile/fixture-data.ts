import type { ExternalResource } from "@/domain/integrations/types";

export type GoogleBusinessProfileFixtureRecord = {
  readonly externalRecordId: string;
  readonly recordType: "google_business_profile.location.v1" | "google_business_profile.review.v1";
  readonly observedAt: string;
  readonly payload: Readonly<Record<string, unknown>>;
};

const externalResources = [
  {
    id: "locations/fixture-harbor-house",
    label: "Harbor House",
    type: "location",
  },
  {
    id: "locations/fixture-river-market",
    label: "River Market",
    type: "location",
  },
] as const satisfies readonly ExternalResource[];

const records = [
  {
    externalRecordId: "locations/fixture-harbor-house",
    recordType: "google_business_profile.location.v1",
    observedAt: "2026-08-01T09:00:00.000Z",
    payload: { name: "Harbor House", primaryCategory: "fixture_location" },
  },
  {
    externalRecordId: "locations/fixture-river-market",
    recordType: "google_business_profile.location.v1",
    observedAt: "2026-08-01T09:00:00.000Z",
    payload: { name: "River Market", primaryCategory: "fixture_location" },
  },
  {
    externalRecordId: "reviews/fixture-harbor-house-001",
    recordType: "google_business_profile.review.v1",
    observedAt: "2026-08-02T12:00:00.000Z",
    payload: { locationId: "locations/fixture-harbor-house", rating: 5, sentiment: "positive" },
  },
  {
    externalRecordId: "reviews/fixture-river-market-001",
    recordType: "google_business_profile.review.v1",
    observedAt: "2026-08-03T15:30:00.000Z",
    payload: { locationId: "locations/fixture-river-market", rating: 4, sentiment: "positive" },
  },
] as const satisfies readonly GoogleBusinessProfileFixtureRecord[];

export function listGoogleBusinessProfileFixtureResources(): ExternalResource[] {
  return externalResources.map((resource) => ({ ...resource }));
}

export function listGoogleBusinessProfileFixtureRecords(input?: {
  partial?: boolean;
}): GoogleBusinessProfileFixtureRecord[] {
  const selected = input?.partial ? [records[0], records[2]] : records;
  return selected.map((record) => ({
    ...record,
    payload: { ...record.payload },
  }));
}
