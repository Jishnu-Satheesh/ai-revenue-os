import { z } from "zod";

import { agentReportScopeSchema, type AgentReportScope } from "./report-intake";

export type AgentReportScopeMetadata = {
  channels: readonly { id: string; label: string; key: string }[];
  aliases: readonly { channelId: string; label: string }[];
  branches: readonly { id: string; label: string; currency: string }[];
  mappings: readonly {
    channelId: string;
    branchId: string;
    effectiveFrom: string | null;
    effectiveTo: string | null;
  }[];
  reportTypes: readonly { channelId: string; reportType: string; aliases: readonly string[] }[];
};

export type AgentReportMetadataField = {
  key: keyof AgentReportScope;
  label: string;
  kind: "text" | "date" | "single_select";
  required: true;
  options?: { value: string; label: string }[];
};

type ScopeResolution =
  | { kind: "resolved"; scope: AgentReportScope }
  | {
      kind: "metadata_required";
      known: Partial<AgentReportScope>;
      fields: AgentReportMetadataField[];
    };

const partialScopeSchema = z
  .object({
    channelId: z.string().uuid().optional(),
    branchId: z.string().uuid().optional(),
    reportType: z
      .string()
      .trim()
      .min(2)
      .max(120)
      .regex(/^[\p{L}\p{N} ._/-]+$/u)
      .optional(),
    periodStart: z.iso.date().optional(),
    periodEnd: z.iso.date().optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
  })
  .strict();

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function mentions(question: string, label: string): boolean {
  const normalized = normalize(label);
  return normalized.length >= 2 && ` ${normalize(question)} `.includes(` ${normalized} `);
}

function one<T>(values: readonly T[]): T | undefined {
  return values.length === 1 ? values[0] : undefined;
}

const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthToken =
  "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";

function day(year: string, month: string, value: string): string {
  const monthNumber = months.indexOf(month.toLowerCase().slice(0, 3)) + 1;
  return `${year}-${String(monthNumber).padStart(2, "0")}-${value.padStart(2, "0")}`;
}

/** Only explicit complete ranges; Date.parse's rollover and locale guesses are excluded. */
export function extractAgentReportPeriod(
  question: string,
): Pick<AgentReportScope, "periodStart" | "periodEnd"> | undefined {
  const ranges: { periodStart: string; periodEnd: string }[] = [];
  for (const match of question.matchAll(
    /\b(\d{4}-\d{2}-\d{2})\s*(?:to|through|until|[-–—])\s*(\d{4}-\d{2}-\d{2})\b/gi,
  )) {
    ranges.push({ periodStart: match[1], periodEnd: match[2] });
  }
  const namedRange = new RegExp(
    `\\b(${monthToken})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:,?\\s*(\\d{4}))?\\s*(?:to|through|until|[-–—])\\s*(?:(${monthToken})\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s*[-,]?\\s*(\\d{4})\\b`,
    "gi",
  );
  for (const match of question.matchAll(namedRange)) {
    ranges.push({
      periodStart: day(match[3] ?? match[6], match[1], match[2]),
      periodEnd: day(match[6], match[4] ?? match[1], match[5]),
    });
  }
  const range = one(ranges);
  if (
    !range ||
    !z.iso.date().safeParse(range.periodStart).success ||
    !z.iso.date().safeParse(range.periodEnd).success ||
    range.periodEnd < range.periodStart
  )
    return undefined;
  return range;
}

/**
 * The exact stored message supplies hints, while organization identities and
 * applicability remain deterministic. Missing facts become issued fields.
 */
export function resolveAgentReportScope(input: {
  question: string;
  metadata: AgentReportScopeMetadata;
  answers?: Record<string, unknown> | null;
}): ScopeResolution {
  const question = z.string().max(20000).parse(input.question);
  const { metadata } = input;
  if (
    metadata.channels.length > 100 ||
    metadata.branches.length > 100 ||
    metadata.aliases.length > 1000 ||
    metadata.reportTypes.length > 1000 ||
    metadata.mappings.length > 1000
  ) {
    throw new Error("Report metadata is not bounded.");
  }
  const answers = partialScopeSchema.parse(input.answers ?? {});
  const known: Partial<AgentReportScope> = { ...extractAgentReportPeriod(question), ...answers };
  const choices = (values: readonly { id: string; label: string }[]) => {
    if (values.length === 0)
      throw new Error("Channel and branch choices are unavailable for this report.");
    if (values.length > 12)
      throw new Error("Choose a more specific channel or branch before uploading this report.");
    return values.map((value) => ({ value: value.id, label: value.label }));
  };
  const matchedChannels = metadata.channels.filter(
    (channel) =>
      mentions(question, channel.label) ||
      mentions(question, channel.key) ||
      metadata.aliases.some(
        (alias) => alias.channelId === channel.id && mentions(question, alias.label),
      ),
  );
  known.channelId ??= one(matchedChannels)?.id;
  if (known.channelId && !metadata.channels.some((channel) => channel.id === known.channelId))
    throw new Error("The selected channel is not available.");
  if (!known.channelId)
    return {
      kind: "metadata_required",
      known,
      fields: [
        {
          key: "channelId",
          label: "Channel",
          kind: "single_select",
          required: true,
          options: choices(metadata.channels),
        },
      ],
    };

  const channelMappings = metadata.mappings.filter(
    (mapping) => mapping.channelId === known.channelId,
  );
  const eligibleBranches = metadata.branches.filter(
    (branch) =>
      channelMappings.length === 0 ||
      channelMappings.some(
        (mapping) =>
          mapping.branchId === branch.id &&
          (!known.periodStart ||
            !mapping.effectiveFrom ||
            mapping.effectiveFrom <= known.periodStart) &&
          (!known.periodEnd || !mapping.effectiveTo || mapping.effectiveTo >= known.periodEnd),
      ),
  );
  known.branchId ??=
    one(eligibleBranches.filter((branch) => mentions(question, branch.label)))?.id ??
    one(eligibleBranches)?.id;
  if (known.branchId && !eligibleBranches.some((branch) => branch.id === known.branchId))
    throw new Error("The selected branch is not available for this report period.");

  const possibleTypes = metadata.reportTypes.filter((item) => item.channelId === known.channelId);
  const namedTypes = possibleTypes.filter((item) => mentions(question, item.reportType));
  const matchedTypes = [
    ...new Set(
      (namedTypes.length
        ? namedTypes
        : possibleTypes.filter((item) => item.aliases.some((alias) => mentions(question, alias)))
      ).map((item) => item.reportType),
    ),
  ];
  known.reportType ??= one(matchedTypes);
  const currencyNames = new Intl.DisplayNames(["en"], { type: "currency" });
  const explicitCurrencies = [
    ...new Set(
      [...question.matchAll(/\b([A-Z]{3})\b/g)]
        .map((match) => match[1])
        .filter((code) => currencyNames.of(code) !== code),
    ),
  ];
  if (!known.currency) {
    known.currency =
      explicitCurrencies.length === 0
        ? (metadata.branches.find((branch) => branch.id === known.branchId)?.currency ??
          one([...new Set(eligibleBranches.map((branch) => branch.currency))]))
        : one(explicitCurrencies);
  }
  if (known.periodStart && known.periodEnd && known.periodEnd < known.periodStart)
    throw new Error("The report period is invalid.");
  const complete = agentReportScopeSchema.safeParse(known);
  if (complete.success) return { kind: "resolved", scope: complete.data };

  const fields: AgentReportMetadataField[] = [];
  if (!known.channelId)
    fields.push({
      key: "channelId",
      label: "Channel",
      kind: "single_select",
      required: true,
      options: choices(metadata.channels),
    });
  if (!known.branchId)
    fields.push({
      key: "branchId",
      label: "Branch",
      kind: "single_select",
      required: true,
      options: choices(eligibleBranches),
    });
  if (!known.reportType)
    fields.push({ key: "reportType", label: "Report type", kind: "text", required: true });
  if (!known.periodStart)
    fields.push({ key: "periodStart", label: "From", kind: "date", required: true });
  if (!known.periodEnd)
    fields.push({ key: "periodEnd", label: "To", kind: "date", required: true });
  if (!known.currency)
    fields.push({ key: "currency", label: "Currency", kind: "text", required: true });
  if (fields.some((field) => field.kind === "single_select" && field.options?.length === 0))
    throw new Error("Channel and branch choices are unavailable for this report.");
  return { kind: "metadata_required", known, fields };
}
