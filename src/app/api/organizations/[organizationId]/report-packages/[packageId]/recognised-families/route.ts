import { matchProviderDefinitions } from "@/domain/reports/provider-library/match";
import { reportPackageRouteParamsSchema, runReportRoute } from "@/modules/reports/application/api";

/**
 * What this upload looks like, and which known report families it could be.
 *
 * Decided from the profile alone — sheet names, positions and digests of the
 * headers — so the answer costs nothing but what profiling already recorded and
 * reveals nothing the profile does not already hold. No workbook value is read.
 *
 * Several families can fit and all of them are returned. The operator says
 * which report they uploaded; a platform that decided on their behalf would
 * eventually decide wrong with nobody watching.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; packageId: string }> },
) {
  return runReportRoute({
    request,
    params,
    paramsSchema: reportPackageRouteParamsSchema,
    handler: async (context) => {
      const snapshot = await context.service.listSnapshot(context);
      const reportPackage = snapshot.packages.find(
        (candidate) => candidate.id === context.params.packageId,
      );
      if (!reportPackage) return { status: 404, body: { recognisedFamilies: [] } };

      const sheets = snapshot.sheetManifests
        .filter((manifest) => manifest.report_package_id === reportPackage.id)
        .map((manifest) => ({
          normalizedSheetName: manifest.normalized_sheet_name,
          sheetPosition: manifest.sheet_position,
          hasFormula: manifest.has_formula,
          hasMergedCells: manifest.has_merged_cells,
          headerCandidateDigests: headerCandidates(manifest.header_candidate_digests),
        }));

      return {
        status: 200,
        body: {
          // The columns an operator needs in order to describe an export the
          // platform does not recognise. Names only, and only normalized ones:
          // the profile holds nothing from under them.
          sheets: snapshot.sheetManifests
            .filter((manifest) => manifest.report_package_id === reportPackage.id)
            .sort((left, right) => left.sheet_position - right.sheet_position)
            .map((manifest) => ({
              normalizedSheetName: manifest.normalized_sheet_name,
              sheetPosition: manifest.sheet_position,
              rowCount: manifest.row_count,
              headerRows: retainedHeaders(manifest.header_candidates),
            })),
          recognisedFamilies: matchProviderDefinitions({
            declaredCurrency: reportPackage.declared_currency,
            sheets,
          }).map((definition) => ({
            key: definition.key,
            provider: definition.provider,
            reportType: definition.reportType,
            summary: definition.summary,
            // What the operator is actually agreeing to read, in their words.
            reads: definition.projection.outputs.map((output) => output.metricKey),
            columns: definition.contract.sheets.flatMap((sheet) =>
              sheet.fields.map((field) => field.sourceHeader),
            ),
          })),
        },
      };
    },
  });
}

type HeaderCandidate = { rowPosition: number; normalizedHeaderDigests: string[] };

/** The candidate header rows whose column names the profile kept. */
function retainedHeaders(value: unknown): { rowPosition: number; columns: string[] }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const candidate = entry as Record<string, unknown>;
    const headers = candidate.normalizedHeaders;
    if (typeof candidate.rowPosition !== "number" || !Array.isArray(headers)) return [];
    return [
      {
        rowPosition: candidate.rowPosition,
        columns: headers.filter((header): header is string => typeof header === "string"),
      },
    ];
  });
}

/**
 * The profile stores header candidates as free-form JSON, so it is narrowed
 * here rather than trusted. A malformed candidate makes a family fail to match,
 * which is the safe direction: nothing is offered that cannot be justified.
 */
function headerCandidates(value: unknown): HeaderCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const candidate = entry as Record<string, unknown>;
    const digests = candidate.normalizedHeaderDigests;
    if (typeof candidate.rowPosition !== "number" || !Array.isArray(digests)) return [];
    return [
      {
        rowPosition: candidate.rowPosition,
        normalizedHeaderDigests: digests.filter(
          (digest): digest is string => typeof digest === "string",
        ),
      },
    ];
  });
}
