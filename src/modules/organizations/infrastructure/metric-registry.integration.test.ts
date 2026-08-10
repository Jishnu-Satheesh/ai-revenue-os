import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260810130000_metric_registry_and_normalized_metrics.sql",
);

const sql = readFileSync(migrationPath, "utf8");

describe("metric registry migration", () => {
  it("keeps industry vocabulary out of core columns", () => {
    for (const industryColumn of ["orders_count", "commission", "menu_item", "preparation_time"]) {
      expect(sql).not.toContain(`${industryColumn} `);
    }
  });

  it("requires a declared value kind and aggregation on every definition", () => {
    expect(sql).toMatch(
      /value_kind text not null check \(\s*value_kind in \('count', 'money', 'ratio', 'duration', 'rating'\)/,
    );
    expect(sql).toContain("aggregation text not null check (");
    expect(sql).toContain(
      "aggregation in ('sum', 'ratio_of_sums', 'mean', 'weighted_mean', 'percentile', 'last')",
    );
  });

  it("ties percentile and rating metadata to the kinds that need it", () => {
    expect(sql).toContain("check ((aggregation = 'percentile') = (percentile_p is not null))");
    expect(sql).toContain(
      "(value_kind = 'rating') = (rating_min is not null and rating_max is not null)",
    );
  });

  it("scopes shared vocabulary globally and custom keys per organization", () => {
    expect(sql).toMatch(
      /create unique index metric_definitions_global_key_idx\s+on public\.metric_definitions \(key\)\s+where organization_id is null;/,
    );
    expect(sql).toMatch(
      /create unique index metric_definitions_organization_key_idx[\s\S]*?where organization_id is not null;/,
    );
    expect(sql).toContain("metric_key_conflicts_with_shared_vocabulary");
  });

  it("stores ratios as numerator and denominator rather than a quotient", () => {
    expect(sql).toContain("value_numerator numeric not null");
    expect(sql).toContain("value_denominator numeric");
    expect(sql).toMatch(
      /when value_kind in \('ratio', 'rating'\) then value_denominator is not null and value_denominator > 0/,
    );
    expect(sql).toContain("else value_denominator is null");
  });

  it("requires a currency for money and forbids one elsewhere", () => {
    expect(sql).toContain("check ((value_kind = 'money') = (currency is not null))");
    expect(sql).toContain(
      "check (value_kind not in ('money', 'count') or value_numerator = trunc(value_numerator))",
    );
  });

  it("records the timezone that period boundaries were computed in", () => {
    expect(sql).toContain("period_timezone text not null");
    expect(sql).toContain("check (period_end > period_start)");
  });

  it("makes observations append-only with one current revision per series", () => {
    expect(sql).toMatch(
      /create unique index normalized_metrics_current_revision_idx[\s\S]*?where superseded_by_id is null;/,
    );
    expect(sql).toContain("normalized_metric_is_append_only");
    expect(sql).toContain("normalized_metric_already_superseded");
    expect(sql).toContain("create trigger normalized_metrics_prevent_mutation");
    expect(sql).not.toContain("is_current");
  });

  it("prevents an organization recording against another organization's definition", () => {
    expect(sql).toContain("metric_definition_belongs_to_another_organization");
    expect(sql).toContain("metric_definition_is_inactive");
    expect(sql).toContain("create trigger normalized_metrics_enforce_definition_tenancy");
  });

  it("binds goals to a registered key without dropping the display metric", () => {
    expect(sql).toContain("alter table public.goals");
    expect(sql).toContain("add column metric_key text check (");
    expect(sql).not.toMatch(/alter table public\.goals[\s\S]*?drop column metric\b/);
  });

  it("grants reads only, leaving writes to the ingestion path", () => {
    expect(sql).toContain("grant select on table public.normalized_metrics to authenticated");
    expect(sql).not.toMatch(/grant [^;]*(insert|update|delete)[^;]*public\.normalized_metrics/);
    expect(sql).not.toMatch(/grant [^;]*(insert|update|delete)[^;]*public\.metric_definitions/);
  });

  it("enables row level security on every new table", () => {
    for (const table of [
      "metric_definitions",
      "metric_dimension_definitions",
      "normalized_metrics",
    ]) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
    }
    expect(sql).toContain("alter table public.normalized_metrics force row level security");
  });

  it("seeds only industry-neutral core vocabulary", () => {
    const seed = sql.slice(sql.indexOf("insert into public.metric_definitions"));
    expect(seed).toContain("'revenue.gross'");
    expect(seed).toContain("'transactions.count'");
    expect(seed).not.toContain("'orders.count'");
  });
});
