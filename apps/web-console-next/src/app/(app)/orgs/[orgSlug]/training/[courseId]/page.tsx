"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { OrgScope } from "@/components/shell/org-scope";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/lib/session";
import { useApiQuery, qk } from "@/lib/query";
import { wrap } from "@/lib/api";
import { completionLine } from "@/lib/quiz-text";
import type { AssignTrainingRequest, PublicTrainingCourse } from "@saas/contracts/tally";

const SELECT = "h-9 w-full rounded-md border bg-background px-3 text-sm";
const FIELD = "block text-sm font-medium mt-3 mb-1";

export default function CoursePage() {
  const params = useParams<{ orgSlug: string; courseId: string }>();
  const slug = params?.orgSlug ?? "";
  const courseId = params?.courseId ?? "";
  return <OrgScope slug={slug}>{(org) => <Inner orgId={org.id} orgSlug={slug} courseId={courseId} />}</OrgScope>;
}

function Inner({ orgId, orgSlug, courseId }: { orgId: string; orgSlug: string; courseId: string }) {
  const { client } = useSession();
  const { toast } = useToast();
  const detail = useApiQuery(qk.trainingCourse(orgId, courseId), () => wrap(async () => client.tally.getCourse(orgId, courseId)));
  const assignments = useApiQuery(qk.trainingAssignments(orgId, courseId), () =>
    wrap(async () => client.tally.listAssignments(orgId, { courseId })),
  );
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);

  if (detail.loading) return <Skeleton className="h-40 w-full" />;
  if (detail.error || !detail.data) return <p className="text-sm text-destructive">{detail.error?.message ?? "Not found"}</p>;
  const { course, materials } = detail.data;

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    const r = await wrap(async () =>
      client.tally.uploadMaterial(orgId, courseId, file, { contentType: file.type || "application/pdf", filename: file.name }),
    );
    setBusy(false);
    if (!r.ok) {
      toast({ kind: "error", title: "Upload failed", description: r.error.message });
      return;
    }
    toast({ kind: "success", title: `Version ${r.data.material.version} stored`, description: `SHA-256 ${r.data.material.sha256}` });
    detail.reload();
  }

  async function setStatus(status: PublicTrainingCourse["status"]) {
    const r = await wrap(async () => client.tally.updateCourse(orgId, courseId, { status }));
    if (!r.ok) toast({ kind: "error", title: "Could not update the course", description: r.error.message });
    detail.reload();
  }

  async function sweep() {
    const r = await wrap(async () => client.tally.runSweep(orgId));
    if (!r.ok) {
      toast({ kind: "error", title: "Could not run the reminders", description: r.error.message });
      return;
    }
    toast({
      kind: "success",
      title: `${r.data.claimed.length} reminder${r.data.claimed.length === 1 ? "" : "s"} sent`,
      description: `${r.data.alreadySent} already sent today; ${r.data.reassigned.length} re-assigned.`,
    });
  }

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <Link href={`/orgs/${orgSlug}/training`} className="text-sm text-muted-foreground underline">
            ← Training
          </Link>
          <h1 className="text-xl font-semibold tracking-tight">{course.title}</h1>
          <p className="text-sm text-muted-foreground">
            {course.status} · {completionLine(detail.data.assignments)} · {detail.data.assignments.overdue} overdue
          </p>
        </div>
        <div className="flex gap-2">
          {course.status !== "published" && <Button onClick={() => setStatus("published")}>Publish</Button>}
          {course.status === "published" && (
            <Button variant="outline" onClick={() => setStatus("archived")}>Archive</Button>
          )}
          <Button variant="outline" onClick={sweep}>Run today&apos;s reminders</Button>
        </div>
      </header>

      {course.summary && <p className="text-sm">{course.summary}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Material</CardTitle>
          <CardDescription>
            Every version is kept. A completion records the SHA-256 of the version the person took. PDF, MP4, PNG, JPEG or Word, up to 50 MB.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <input ref={fileRef} type="file" accept=".pdf,.mp4,.png,.jpg,.jpeg,.docx" className="text-sm" />
            <Button onClick={upload} disabled={busy}>Upload a new version</Button>
          </div>
          {materials.length === 0 ? (
            <p className="text-sm text-muted-foreground">No material yet.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Version</TH>
                  <TH>File</TH>
                  <TH>Size</TH>
                  <TH>SHA-256</TH>
                  <TH>Uploaded</TH>
                </TR>
              </THead>
              <TBody>
                {materials.map((m) => (
                  <TR key={m.id}>
                    <TD>v{m.version}</TD>
                    <TD className="text-sm">{m.filename}</TD>
                    <TD className="text-sm">{Math.ceil(m.byteSize / 1024)} KB</TD>
                    <TD className="font-mono text-xs">{m.sha256.slice(0, 16)}…</TD>
                    <TD className="text-sm">{m.uploadedAt.slice(0, 10)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {course.status === "published" && materials.length > 0 && (
        <AssignForm orgId={orgId} course={course} onDone={() => { detail.reload(); assignments.reload(); }} />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Assignments</CardTitle>
        </CardHeader>
        <CardContent>
          {assignments.loading ? (
            <Skeleton className="h-24 w-full" />
          ) : (assignments.data?.assignments ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nobody is assigned yet.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Person</TH>
                  <TH>Cycle</TH>
                  <TH>Due</TH>
                  <TH>Status</TH>
                  <TH>Completed</TH>
                  <TH>Score</TH>
                  <TH>Material taken</TH>
                </TR>
              </THead>
              <TBody>
                {assignments.data!.assignments.map((a) => (
                  <TR key={a.id}>
                    <TD className="text-sm">{a.assigneeEmail}</TD>
                    <TD className="text-sm">{a.cycle}</TD>
                    <TD className={a.overdue ? "text-sm text-destructive" : "text-sm"}>{a.dueOn}</TD>
                    <TD className="text-sm">{a.status}</TD>
                    <TD className="text-sm">{a.completedAt ? a.completedAt.slice(0, 16).replace("T", " ") : "—"}</TD>
                    <TD className="text-sm">{a.scorePct === null ? "—" : `${a.scorePct}%`}</TD>
                    <TD className="font-mono text-xs">{a.materialSha256 ? `v${a.materialVersion} · ${a.materialSha256.slice(0, 12)}…` : "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AssignForm({ orgId, course, onDone }: { orgId: string; course: PublicTrainingCourse; onDone: () => void }) {
  const { client } = useSession();
  const { toast } = useToast();
  const [mode, setMode] = React.useState<"emails" | "everyone" | "toolUsers">("emails");
  const [emails, setEmails] = React.useState("");
  const [dueOn, setDueOn] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const due = dueOn ? { dueOn } : {};
    const body: AssignTrainingRequest =
      mode === "emails"
        ? { emails: emails.split(/[\s,;]+/).filter(Boolean), ...due }
        : mode === "everyone"
          ? { everyone: true, ...due }
          : { toolUsers: true, ...due };
    setBusy(true);
    const r = await wrap(async () => client.tally.assign(orgId, course.id, body));
    setBusy(false);
    if (!r.ok) {
      toast({ kind: "error", title: "Could not assign", description: r.error.message });
      return;
    }
    toast({
      kind: "success",
      title: `Assigned to ${r.data.created.length}`,
      description: r.data.skipped.length ? `${r.data.skipped.length} already had it open.` : undefined,
    });
    setEmails("");
    onDone();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Assign</CardTitle>
        <CardDescription>Due {course.dueDays} days from today unless you set a date. Each person is emailed.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit}>
          <label className={FIELD} htmlFor="mode">To</label>
          <select id="mode" className={SELECT} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            <option value="emails">These people</option>
            <option value="everyone">Everyone in the organization</option>
            {course.toolId && <option value="toolUsers">The named users of this course&apos;s tool</option>}
          </select>
          {mode === "emails" && (
            <>
              <label className={FIELD} htmlFor="emails">Email addresses</label>
              <Textarea id="emails" rows={3} value={emails} onChange={(e) => setEmails(e.target.value)} />
            </>
          )}
          <label className={FIELD} htmlFor="dueOn">Due on (optional)</label>
          <Input id="dueOn" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
          <div className="mt-4">
            <Button type="submit" disabled={busy}>Assign</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
