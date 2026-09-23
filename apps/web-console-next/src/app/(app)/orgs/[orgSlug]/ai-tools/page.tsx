"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Bot } from "lucide-react";
import { OrgScope } from "@/components/shell/org-scope";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useSession } from "@/lib/session";
import { useApiQuery, qk } from "@/lib/query";
import { wrap } from "@/lib/api";
import { ReviewDate, RiskBadge, StatusBadge } from "@/components/tally/badges";
import { ToolForm } from "@/components/tally/tool-form";
import {
  AI_TOOL_CATEGORY_LABELS,
  AI_TOOL_STATUSES,
  type AiRegisterSummary,
  type AiToolStatus,
  type PublicAiTool,
} from "@saas/contracts/tally";

export default function AiToolsPage() {
  const params = useParams<{ orgSlug: string }>();
  const slug = params?.orgSlug ?? "";
  return <OrgScope slug={slug}>{(org) => <Inner orgId={org.id} orgSlug={slug} />}</OrgScope>;
}

function Inner({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const { client } = useSession();
  const register = useApiQuery(qk.aiTools(orgId), () => wrap(async () => client.tally.listTools(orgId)));
  const [creating, setCreating] = React.useState(false);
  const [status, setStatus] = React.useState<AiToolStatus | "in_use">("in_use");

  const tools = (register.data?.tools ?? []).filter((t) =>
    status === "in_use" ? t.status !== "retired" : t.status === status,
  );

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">AI register</h1>
          <p className="text-sm text-muted-foreground">
            Every AI tool your company uses: what it is for, which data reaches it, its risk level, and who answers for it.
          </p>
        </div>
        {!creating && <Button onClick={() => setCreating(true)}>Register a tool</Button>}
      </header>

      {creating && (
        <ToolForm
          orgId={orgId}
          tool={null}
          onDone={() => {
            setCreating(false);
            register.reload();
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {register.loading ? (
        <Skeleton className="h-20 w-full" />
      ) : register.data ? (
        <SummaryTiles summary={register.data.summary} />
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Tools</CardTitle>
            <CardDescription>Retired tools stay in the register as evidence.</CardDescription>
          </div>
          <select
            aria-label="Filter by status"
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value as AiToolStatus | "in_use")}
          >
            <option value="in_use">In use (not retired)</option>
            {AI_TOOL_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </CardHeader>
        <CardContent>
          {register.loading ? (
            <Skeleton className="h-24 w-full" />
          ) : register.error ? (
            <p className="text-sm text-destructive">{register.error.message}</p>
          ) : (register.data?.tools ?? []).length === 0 ? (
            <div className="flex flex-col items-center py-10 text-center text-sm text-muted-foreground">
              <Bot className="mb-3 h-8 w-8 text-primary" />
              No AI tools registered yet. Start with the ones your staff already use every day.
            </div>
          ) : tools.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tools with this status.</p>
          ) : (
            <ToolsTable orgSlug={orgSlug} tools={tools} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryTiles({ summary }: { summary: AiRegisterSummary }) {
  const tiles = [
    { label: "Tools in use", value: summary.inUse },
    { label: "High risk", value: summary.byRiskLevel.high },
    { label: "Not yet assessed", value: summary.byRiskLevel.unassessed },
    { label: "Reviews due", value: summary.reviewsDue },
    { label: "Receive personal data", value: summary.withPersonalData },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {tiles.map((t) => (
        <Card key={t.label}>
          <CardContent className="py-4">
            <div className="text-2xl font-semibold">{t.value}</div>
            <div className="text-xs text-muted-foreground">{t.label}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ToolsTable({ orgSlug, tools }: { orgSlug: string; tools: PublicAiTool[] }) {
  return (
    <Table>
      <THead>
        <TR>
          <TH>Tool</TH>
          <TH>Used for</TH>
          <TH>Owner</TH>
          <TH>Risk</TH>
          <TH>Status</TH>
          <TH>Next review</TH>
        </TR>
      </THead>
      <TBody>
        {tools.map((t) => (
          <TR key={t.id}>
            <TD>
              <Link className="font-medium underline" href={`/orgs/${orgSlug}/ai-tools/${t.id}`}>
                {t.name}
              </Link>
              <div className="text-xs text-muted-foreground">
                {t.vendor ? `${t.vendor} · ` : ""}
                {AI_TOOL_CATEGORY_LABELS[t.category] ?? t.category}
              </div>
            </TD>
            <TD className="max-w-xs truncate text-sm" title={t.purpose}>{t.purpose}</TD>
            <TD className="text-sm">{t.ownerEmail}</TD>
            <TD><RiskBadge level={t.riskLevel} /></TD>
            <TD><StatusBadge status={t.status} /></TD>
            <TD><ReviewDate nextReviewOn={t.nextReviewOn} reviewDue={t.reviewDue} /></TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
