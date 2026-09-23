"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { OrgScope } from "@/components/shell/org-scope";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useSession } from "@/lib/session";
import { useApiQuery, qk } from "@/lib/query";
import { useToast } from "@/components/ui/toast";
import { wrap } from "@/lib/api";
import { ReviewDate, RiskBadge, StatusBadge } from "@/components/tally/badges";
import { ToolForm } from "@/components/tally/tool-form";
import {
  AI_DATA_CATEGORY_LABELS,
  AI_REVIEW_DECISIONS,
  AI_RISK_LEVELS,
  AI_RISK_LEVEL_LABELS,
  AI_TOOL_CATEGORY_LABELS,
  isRiskStatusAllowed,
  type AiReviewDecision,
  type AiRiskLevel,
  type GetAiToolResponse,
  type PublicAiTool,
  type PublicAiToolReview,
} from "@saas/contracts/tally";

export default function AiToolPage() {
  const params = useParams<{ orgSlug: string; toolId: string }>();
  const slug = params?.orgSlug ?? "";
  const toolId = params?.toolId ?? "";
  return <OrgScope slug={slug}>{(org) => <Inner orgId={org.id} orgSlug={slug} toolId={toolId} />}</OrgScope>;
}

function Inner({ orgId, orgSlug, toolId }: { orgId: string; orgSlug: string; toolId: string }) {
  const { client } = useSession();
  const detail = useApiQuery(qk.aiTool(orgId, toolId), () => wrap(async () => client.tally.getTool(orgId, toolId)));

  if (detail.loading) return <Skeleton className="h-40 w-full" />;
  if (detail.error || !detail.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-destructive">{detail.error?.code ?? "not_found"}</CardTitle>
          <CardDescription>{detail.error?.message ?? "Tool not found"}</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  return <Detail orgId={orgId} orgSlug={orgSlug} data={detail.data} reload={detail.reload} />;
}

function Detail({
  orgId,
  orgSlug,
  data,
  reload,
}: {
  orgId: string;
  orgSlug: string;
  data: GetAiToolResponse;
  reload: () => void;
}) {
  const { tool, reviews } = data;
  const [editing, setEditing] = React.useState(false);
  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <Link className="text-xs text-muted-foreground underline" href={`/orgs/${orgSlug}/ai-tools`}>
            ← AI register
          </Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">{tool.name}</h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {tool.vendor || "—"} · {AI_TOOL_CATEGORY_LABELS[tool.category] ?? tool.category} ·{" "}
            <RiskBadge level={tool.riskLevel} /> <StatusBadge status={tool.status} />
          </p>
        </div>
        {!editing && (
          <Button variant="outline" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
      </header>

      {editing ? (
        <ToolForm
          orgId={orgId}
          tool={tool}
          onDone={() => {
            setEditing(false);
            reload();
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <Facts tool={tool} />
      )}

      <ReviewForm orgId={orgId} tool={tool} onDone={reload} />
      <ReviewHistory reviews={reviews} />
    </div>
  );
}

function Facts({ tool }: { tool: PublicAiTool }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">In the register</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm sm:grid-cols-2">
        <div className="sm:col-span-2">
          <div className="text-xs text-muted-foreground">Used for</div>
          <p className="whitespace-pre-wrap">{tool.purpose}</p>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Data that reaches it</div>
          {tool.dataCategories.length === 0 ? (
            "None recorded"
          ) : (
            <ul className="list-inside list-disc">
              {tool.dataCategories.map((c) => (
                <li key={c}>{AI_DATA_CATEGORY_LABELS[c] ?? c}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="space-y-3">
          <div>
            <div className="text-xs text-muted-foreground">Accountable owner</div>
            {tool.ownerEmail}
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Who uses it</div>
            {tool.usersDescription || "—"}
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Role under the AI Act</div>
            {tool.actRole === "deployer" ? "Deployer (Art. 3(4))" : "Provider (Art. 3(3))"}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Last reviewed</div>
          {tool.lastReviewedOn ?? "Never"}
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Next review (every {tool.reviewIntervalMonths} months)</div>
          <ReviewDate nextReviewOn={tool.nextReviewOn} reviewDue={tool.reviewDue} />
        </div>
        {tool.websiteUrl && (
          <div>
            <div className="text-xs text-muted-foreground">Website</div>
            <a className="underline" href={tool.websiteUrl} target="_blank" rel="noreferrer noopener">
              {tool.websiteUrl}
            </a>
          </div>
        )}
        {tool.notes && (
          <div className="sm:col-span-2">
            <div className="text-xs text-muted-foreground">Notes</div>
            <p className="whitespace-pre-wrap">{tool.notes}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const SELECT = "h-9 w-full rounded-md border bg-background px-3 text-sm";
const FIELD = "block text-sm font-medium mb-1";

function ReviewForm({ orgId, tool, onDone }: { orgId: string; tool: PublicAiTool; onDone: () => void }) {
  const { client } = useSession();
  const { toast } = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = React.useState<{ reviewedOn: string; decision: AiReviewDecision; riskLevel: AiRiskLevel; notes: string }>({
    reviewedOn: today,
    decision: tool.status === "proposed" ? "approved" : (tool.status as AiReviewDecision),
    riskLevel: tool.riskLevel,
    notes: "",
  });
  const [busy, setBusy] = React.useState(false);
  const clash = !isRiskStatusAllowed(form.riskLevel, form.decision);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await wrap(async () => client.tally.createReview(orgId, tool.id, form));
    setBusy(false);
    if (!r.ok) {
      toast({ kind: "error", title: "Could not record the review", description: r.error.message });
      return;
    }
    toast({
      kind: "success",
      title: "Review recorded",
      description: r.data.applied
        ? `Next review due ${r.data.tool.nextReviewOn}.`
        : "It is older than the last review, so it joins the history without changing the tool.",
    });
    setForm((f) => ({ ...f, notes: "" }));
    onDone();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Record a review</CardTitle>
        <CardDescription>A dated decision about this tool. It sets the status and risk level and schedules the next review.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-4 sm:items-end">
          <div>
            <label className={FIELD} htmlFor="r-date">Reviewed on</label>
            <Input id="r-date" type="date" max={today} value={form.reviewedOn} onChange={(e) => setForm((f) => ({ ...f, reviewedOn: e.target.value }))} required />
          </div>
          <div>
            <label className={FIELD} htmlFor="r-decision">Decision</label>
            <select id="r-decision" className={SELECT} value={form.decision} onChange={(e) => setForm((f) => ({ ...f, decision: e.target.value as AiReviewDecision }))}>
              {AI_REVIEW_DECISIONS.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={FIELD} htmlFor="r-risk">Risk level</label>
            <select id="r-risk" className={SELECT} value={form.riskLevel} onChange={(e) => setForm((f) => ({ ...f, riskLevel: e.target.value as AiRiskLevel }))}>
              {AI_RISK_LEVELS.map((r) => (
                <option key={r} value={r}>{AI_RISK_LEVEL_LABELS[r]}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-4">
            <label className={FIELD} htmlFor="r-notes">Notes</label>
            <Textarea id="r-notes" rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
          {clash && (
            <p className="text-sm text-destructive sm:col-span-4">A prohibited practice can only be blocked or retired.</p>
          )}
          <div className="sm:col-span-4">
            <Button type="submit" disabled={busy || clash}>{busy ? "Saving…" : "Record review"}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function ReviewHistory({ reviews }: { reviews: PublicAiToolReview[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Review history</CardTitle>
        <CardDescription>Every review is kept, newest first.</CardDescription>
      </CardHeader>
      <CardContent>
        {reviews.length === 0 ? (
          <p className="text-sm text-muted-foreground">Not reviewed yet.</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Date</TH>
                <TH>Decision</TH>
                <TH>Risk</TH>
                <TH>Reviewer</TH>
                <TH>Notes</TH>
              </TR>
            </THead>
            <TBody>
              {reviews.map((r) => (
                <TR key={r.id}>
                  <TD className="whitespace-nowrap text-sm">{r.reviewedOn}</TD>
                  <TD><StatusBadge status={r.decision} /></TD>
                  <TD><RiskBadge level={r.riskLevel} /></TD>
                  <TD className="text-sm">{r.reviewerEmail ?? "—"}</TD>
                  <TD className="max-w-md whitespace-pre-wrap text-sm">{r.notes || "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
