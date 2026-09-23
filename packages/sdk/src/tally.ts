import type {
  AiToolResponse,
  AiToolReviewResponse,
  CreateAiToolRequest,
  CreateAiToolReviewRequest,
  GetAiToolResponse,
  ListAiToolsResponse,
  UpdateAiToolRequest,
} from "@saas/contracts/tally";

import type { RequestOptions, Transport } from "./transport.js";

const org = (orgId: string): string => `/v1/organizations/${encodeURIComponent(orgId)}`;
const tool = (orgId: string, toolId: string): string => `${org(orgId)}/ai-tools/${encodeURIComponent(toolId)}`;

/**
 * Aitally client — the AI tool register and each tool's dated reviews.
 * Org-scoped; maps to `apps/tally-worker` through the api-edge tally facade.
 */
export class TallyClient {
  constructor(private readonly transport: Transport) {}

  /** GET /v1/organizations/:orgId/ai-tools — the register and its summary (the summary ignores the filter). */
  listTools(
    orgId: string,
    query: { status?: string; riskLevel?: string } = {},
    opts: RequestOptions = {},
  ): Promise<ListAiToolsResponse> {
    return this.transport.request<ListAiToolsResponse>(
      { method: "GET", path: `${org(orgId)}/ai-tools`, query: { status: query.status, riskLevel: query.riskLevel } },
      opts,
    );
  }

  /** POST /v1/organizations/:orgId/ai-tools */
  createTool(orgId: string, body: CreateAiToolRequest, opts: RequestOptions = {}): Promise<AiToolResponse> {
    return this.transport.request<AiToolResponse>({ method: "POST", path: `${org(orgId)}/ai-tools`, body }, opts);
  }

  /** GET /v1/organizations/:orgId/ai-tools/:toolId — the tool with its reviews, newest first. */
  getTool(orgId: string, toolId: string, opts: RequestOptions = {}): Promise<GetAiToolResponse> {
    return this.transport.request<GetAiToolResponse>({ method: "GET", path: tool(orgId, toolId) }, opts);
  }

  /** PATCH /v1/organizations/:orgId/ai-tools/:toolId */
  updateTool(orgId: string, toolId: string, body: UpdateAiToolRequest, opts: RequestOptions = {}): Promise<AiToolResponse> {
    return this.transport.request<AiToolResponse>({ method: "PATCH", path: tool(orgId, toolId), body }, opts);
  }

  /** POST /v1/organizations/:orgId/ai-tools/:toolId/reviews */
  createReview(
    orgId: string,
    toolId: string,
    body: CreateAiToolReviewRequest,
    opts: RequestOptions = {},
  ): Promise<AiToolReviewResponse> {
    return this.transport.request<AiToolReviewResponse>(
      { method: "POST", path: `${tool(orgId, toolId)}/reviews`, body },
      opts,
    );
  }
}
