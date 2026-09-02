import { reportPackageUploadIntentSchema } from "@/domain/reports/schemas";
import { env } from "@/lib/env";
import {
  organizationReportRouteParamsSchema,
  reportRequest,
  runReportRoute,
} from "@/modules/reports/application/api";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  return runReportRoute({
    request,
    params,
    paramsSchema: organizationReportRouteParamsSchema,
    handler: async (context) => {
      const body = await reportRequest(request, reportPackageUploadIntentSchema);
      const result = await context.service.beginUpload(context, body);
      return {
        status: 201,
        body: {
          reportPackage: result.package,
          upload: {
            endpoint: new URL(
              "/storage/v1/upload/resumable/sign",
              env.NEXT_PUBLIC_SUPABASE_URL,
            ).toString(),
            token: result.upload.token,
            apiKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
            chunkSize: 6 * 1024 * 1024,
          },
        },
      };
    },
  });
}
