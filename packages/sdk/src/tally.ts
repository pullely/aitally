import type {
  CreateEvidencePackRequest,
  EmployeeEvidenceResponse,
  EvidencePackResponse,
  ListEvidencePacksResponse,
  ToolEvidenceResponse,
  AssignTrainingRequest,
  AssignTrainingResponse,
  CompleteTrainingRequest,
  CompleteTrainingResponse,
  CreateTrainingCourseRequest,
  GetTrainingCourseResponse,
  ListTrainingAssignmentsResponse,
  ListTrainingCoursesResponse,
  MyTrainingResponse,
  PublicTrainingMaterial,
  ToolUsersResponse,
  TrainingCourseResponse,
  TrainingSweepResponse,
  UpdateTrainingCourseRequest,
  AiToolResponse,
  AiToolReviewResponse,
  CreateAiToolRequest,
  CreateAiToolReviewRequest,
  GetAiToolResponse,
  ListAiToolsResponse,
  UpdateAiToolRequest,
} from "@saas/contracts/tally";

import { decodeError } from "./errors.js";
import { generateRequestId, type RequestOptions, type Transport } from "./transport.js";

const org = (orgId: string): string => `/v1/organizations/${encodeURIComponent(orgId)}`;
const tool = (orgId: string, toolId: string): string => `${org(orgId)}/ai-tools/${encodeURIComponent(toolId)}`;
const course = (orgId: string, courseId: string): string =>
  `${org(orgId)}/training/courses/${encodeURIComponent(courseId)}`;

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

  // ── AT2: training ─────────────────────────────────────────

  /** GET /v1/organizations/:orgId/ai-tools/:toolId/users — the tool's named users. */
  getToolUsers(orgId: string, toolId: string, opts: RequestOptions = {}): Promise<ToolUsersResponse> {
    return this.transport.request<ToolUsersResponse>({ method: "GET", path: `${tool(orgId, toolId)}/users` }, opts);
  }

  /** PUT /v1/organizations/:orgId/ai-tools/:toolId/users — replace the tool's named users. */
  setToolUsers(orgId: string, toolId: string, emails: string[], opts: RequestOptions = {}): Promise<ToolUsersResponse> {
    return this.transport.request<ToolUsersResponse>({ method: "PUT", path: `${tool(orgId, toolId)}/users`, body: { emails } }, opts);
  }

  listCourses(orgId: string, opts: RequestOptions = {}): Promise<ListTrainingCoursesResponse> {
    return this.transport.request<ListTrainingCoursesResponse>({ method: "GET", path: `${org(orgId)}/training/courses` }, opts);
  }

  createCourse(orgId: string, body: CreateTrainingCourseRequest, opts: RequestOptions = {}): Promise<TrainingCourseResponse> {
    return this.transport.request<TrainingCourseResponse>({ method: "POST", path: `${org(orgId)}/training/courses`, body }, opts);
  }

  getCourse(orgId: string, courseId: string, opts: RequestOptions = {}): Promise<GetTrainingCourseResponse> {
    return this.transport.request<GetTrainingCourseResponse>({ method: "GET", path: course(orgId, courseId) }, opts);
  }

  updateCourse(
    orgId: string,
    courseId: string,
    body: UpdateTrainingCourseRequest,
    opts: RequestOptions = {},
  ): Promise<TrainingCourseResponse> {
    return this.transport.request<TrainingCourseResponse>({ method: "PATCH", path: course(orgId, courseId), body }, opts);
  }

  /**
   * POST /v1/organizations/:orgId/training/courses/:courseId/materials — the
   * body is the file itself (PDF, MP4, PNG, JPEG or Word, up to 50 MB), not JSON.
   */
  async uploadMaterial(
    orgId: string,
    courseId: string,
    file: Blob | ArrayBuffer | Uint8Array,
    meta: { contentType: string; filename: string },
    opts: RequestOptions = {},
  ): Promise<{ material: PublicTrainingMaterial }> {
    const t = this.transport;
    const requestId = opts.requestId ?? generateRequestId();
    const headers = new Headers();
    for (const [k, v] of Object.entries(t.defaultHeaders)) headers.set(k, v);
    if (t.auth?.kind === "bearer") headers.set("authorization", `Bearer ${t.auth.token}`);
    if (t.auth?.kind === "session") headers.set("cookie", t.auth.cookie);
    headers.set("content-type", meta.contentType);
    headers.set("x-filename", meta.filename);
    headers.set("accept", "application/json");
    headers.set("x-request-id", requestId);
    if (opts.idempotencyKey !== undefined) headers.set("idempotency-key", opts.idempotencyKey);
    const init: RequestInit = { method: "POST", headers, body: file as BodyInit };
    if (opts.signal !== undefined) init.signal = opts.signal;
    const response = await t.fetchImpl(`${t.baseUrl}${course(orgId, courseId)}/materials`, init);
    if (!response.ok) throw await decodeError(response, requestId);
    const parsed = (await response.json()) as { data: { material: PublicTrainingMaterial } };
    return parsed.data;
  }

  /** The URL a material version downloads from (the caller supplies its own credentials). */
  materialUrl(orgId: string, courseId: string, materialId: string): string {
    return `${this.transport.baseUrl}${course(orgId, courseId)}/materials/${encodeURIComponent(materialId)}`;
  }

  assign(orgId: string, courseId: string, body: AssignTrainingRequest, opts: RequestOptions = {}): Promise<AssignTrainingResponse> {
    return this.transport.request<AssignTrainingResponse>({ method: "POST", path: `${course(orgId, courseId)}/assign`, body }, opts);
  }

  listAssignments(
    orgId: string,
    query: { status?: string; email?: string; courseId?: string } = {},
    opts: RequestOptions = {},
  ): Promise<ListTrainingAssignmentsResponse> {
    return this.transport.request<ListTrainingAssignmentsResponse>(
      { method: "GET", path: `${org(orgId)}/training/assignments`, query: { status: query.status, email: query.email, courseId: query.courseId } },
      opts,
    );
  }

  /** POST …/training/assignments/:assignmentId/complete — the assignee only. */
  complete(
    orgId: string,
    assignmentId: string,
    body: CompleteTrainingRequest = {},
    opts: RequestOptions = {},
  ): Promise<CompleteTrainingResponse> {
    return this.transport.request<CompleteTrainingResponse>(
      { method: "POST", path: `${org(orgId)}/training/assignments/${encodeURIComponent(assignmentId)}/complete`, body },
      opts,
    );
  }

  /** POST …/training/sweep — run today's training clock for this org now (writers). */
  runSweep(orgId: string, opts: RequestOptions = {}): Promise<TrainingSweepResponse> {
    return this.transport.request<TrainingSweepResponse>({ method: "POST", path: `${org(orgId)}/training/sweep`, body: {} }, opts);
  }

  /** GET /v1/me/training — the caller's own assignments across their organizations. */
  myTraining(opts: RequestOptions = {}): Promise<MyTrainingResponse> {
    return this.transport.request<MyTrainingResponse>({ method: "GET", path: "/v1/me/training" }, opts);
  }

  // ── AT3: evidence ─────────────────────────────────────────

  /** GET …/evidence/employees/:email — exactly that person's training record (JSON; `evidenceUrl` for CSV). */
  employeeEvidence(orgId: string, email: string, opts: RequestOptions = {}): Promise<EmployeeEvidenceResponse> {
    return this.transport.request<EmployeeEvidenceResponse>(
      { method: "GET", path: `${org(orgId)}/evidence/employees/${encodeURIComponent(email)}` },
      opts,
    );
  }

  /** GET …/evidence/tools/:toolId — the tool, its reviews, its users and the training for it. */
  toolEvidence(orgId: string, toolId: string, opts: RequestOptions = {}): Promise<ToolEvidenceResponse> {
    return this.transport.request<ToolEvidenceResponse>({ method: "GET", path: `${org(orgId)}/evidence/tools/${encodeURIComponent(toolId)}` }, opts);
  }

  /** POST …/evidence-packs — build an immutable pack in R2. */
  createEvidencePack(orgId: string, body: CreateEvidencePackRequest, opts: RequestOptions = {}): Promise<EvidencePackResponse> {
    return this.transport.request<EvidencePackResponse>({ method: "POST", path: `${org(orgId)}/evidence-packs`, body }, opts);
  }

  listEvidencePacks(orgId: string, opts: RequestOptions = {}): Promise<ListEvidencePacksResponse> {
    return this.transport.request<ListEvidencePacksResponse>({ method: "GET", path: `${org(orgId)}/evidence-packs` }, opts);
  }

  /** The URL one file of a pack downloads from (the caller supplies its own credentials). */
  evidencePackFileUrl(orgId: string, packId: string, name: string): string {
    return `${this.transport.baseUrl}${org(orgId)}/evidence-packs/${encodeURIComponent(packId)}/files/${encodeURIComponent(name)}`;
  }

  /** The CSV export of one person's or one tool's training record. */
  evidenceCsvUrl(orgId: string, kind: "employees" | "tools", subject: string): string {
    return `${this.transport.baseUrl}${org(orgId)}/evidence/${kind}/${encodeURIComponent(subject)}?format=csv`;
  }
}
