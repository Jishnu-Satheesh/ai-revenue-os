export { routeAgentMessage, type RouterDeps } from "@/modules/agent-router/application/router-service";
export {
  createFailClosedLightModelProvider,
  createGoogleLightModelProvider,
  createLightModelProvider,
  createStubLightModelProvider,
  routerProposalSchema,
  ROUTER_MODEL_VERSION,
  ROUTER_PROVIDER_TIMEOUT_MS,
  type LightModelPort,
  type LightModelRequest,
  type RouterProposal,
} from "@/modules/agent-router/infrastructure/light-model-provider";
export type {
  ActiveWatchCandidate,
  AgentIntent,
  MissingField,
  QuestionnaireItem,
  QuestionnaireKind,
  QuestionnaireSpec,
  RouterConfidence,
  RouterInput,
  RouterOutput,
  RouterRole,
} from "@/domain/agent-router/index";
