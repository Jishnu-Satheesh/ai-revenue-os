import {
  researchScheduleSchema,
  type ResearchSchedule,
  type ResearchScheduleInput,
} from "@/domain/campaigns/research-cadence";
import {
  isResearchPersistenceFailure,
  researchFailure,
  type ResearchPersistence,
} from "@/modules/campaigns/infrastructure/research-policy-repository";

/**
 * The research cadence an organization configures.
 *
 * The money lives on the policy; the rhythm lives here. Reading and writing
 * take the same permission that spends the allowance, because whoever may
 * spend it is whoever may set how often it is spent. No row is "not
 * scheduled", never an implied cadence — and enabling the rhythm never
 * enables spending, which stays bound to the policy's own switch.
 */

export type ResearchScheduleStore = {
  readSchedule(input: { organizationId: string }): Promise<ResearchSchedule | null>;
  saveSchedule(input: {
    organizationId: string;
    schedule: ResearchScheduleInput;
  }): Promise<{ organizationId: string; enabled: boolean }>;
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

export function createResearchScheduleRepository(
  client: ResearchPersistence,
): ResearchScheduleStore {
  return {
    async readSchedule(input): Promise<ResearchSchedule | null> {
      const { data, error } = await client.rpc("read_campaign_research_schedule", {
        target_organization_id: input.organizationId,
      });
      if (error) throw researchFailure(error);

      const scheduleValue = record(data).schedule;
      if (scheduleValue === null || scheduleValue === undefined) return null;
      // Parsed rather than cast: a schedule row that no longer satisfies the
      // current schema schedules nothing, instead of admitting under rules
      // nobody validated.
      return researchScheduleSchema.parse(scheduleValue);
    },

    async saveSchedule(input) {
      const { schedule } = input;
      const { data, error } = await client.rpc("save_campaign_research_schedule", {
        target_organization_id: input.organizationId,
        input_schedule: {
          enabled: schedule.enabled,
          interval_days: schedule.intervalDays,
          qualifying_change_kinds: [...schedule.qualifyingChangeKinds],
        },
      });
      if (error) throw researchFailure(error);

      const row = record(data);
      const organizationId = row.organization_id;
      if (typeof organizationId !== "string" || organizationId.length === 0) {
        throw researchFailure({ message: "campaign_research_invalid" });
      }
      return { organizationId, enabled: row.enabled === true };
    },
  };
}

export type { ResearchSchedule, ResearchScheduleInput };
export { isResearchPersistenceFailure };
