"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { BookOpen } from "lucide-react";
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
import { completionLine, parseQuizText } from "@/lib/quiz-text";

const SELECT = "h-9 w-full rounded-md border bg-background px-3 text-sm";
const FIELD = "block text-sm font-medium mt-3 mb-1";

export default function TrainingPage() {
  const params = useParams<{ orgSlug: string }>();
  const slug = params?.orgSlug ?? "";
  return <OrgScope slug={slug}>{(org) => <Inner orgId={org.id} orgSlug={slug} />}</OrgScope>;
}

function Inner({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const { client } = useSession();
  const courses = useApiQuery(qk.trainingCourses(orgId), () => wrap(async () => client.tally.listCourses(orgId)));
  const [creating, setCreating] = React.useState(false);

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Training</h1>
          <p className="text-sm text-muted-foreground">
            The AI-literacy training your company assigns: who was assigned what, when it is due, and who completed it on which version of
            the material.
          </p>
        </div>
        {!creating && <Button onClick={() => setCreating(true)}>New course</Button>}
      </header>

      {creating && (
        <CourseForm
          orgId={orgId}
          onDone={() => {
            setCreating(false);
            courses.reload();
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Courses</CardTitle>
          <CardDescription>Completion is recorded per person and cycle; a recurring course is re-assigned after each completion.</CardDescription>
        </CardHeader>
        <CardContent>
          {courses.loading ? (
            <Skeleton className="h-24 w-full" />
          ) : courses.error ? (
            <p className="text-sm text-destructive">{courses.error.message}</p>
          ) : (courses.data?.courses ?? []).length === 0 ? (
            <div className="flex flex-col items-center py-10 text-center text-sm text-muted-foreground">
              <BookOpen className="mb-3 h-8 w-8 text-primary" />
              No courses yet. Upload your own material: Aitally stores it and records who took which version.
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Course</TH>
                  <TH>Status</TH>
                  <TH>Material</TH>
                  <TH>Assigned</TH>
                  <TH>Overdue</TH>
                </TR>
              </THead>
              <TBody>
                {courses.data!.courses.map((c) => (
                  <TR key={c.id}>
                    <TD>
                      <Link className="font-medium underline" href={`/orgs/${orgSlug}/training/${c.id}`}>
                        {c.title}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {c.quiz ? `Quiz of ${c.quiz.length}, pass mark ${c.passMarkPct}%` : "No quiz"} · due {c.dueDays} days after assignment
                        {c.recurrenceMonths > 0 ? ` · repeats every ${c.recurrenceMonths} months` : " · once"}
                      </div>
                    </TD>
                    <TD className="text-sm">{c.status}</TD>
                    <TD className="text-sm">{c.currentMaterial ? `v${c.currentMaterial.version} · ${c.currentMaterial.filename}` : "none yet"}</TD>
                    <TD className="text-sm">{completionLine(c.assignments)}</TD>
                    <TD className="text-sm">{c.assignments.overdue}</TD>
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

function CourseForm({ orgId, onDone, onCancel }: { orgId: string; onDone: () => void; onCancel: () => void }) {
  const { client } = useSession();
  const { toast } = useToast();
  const tools = useApiQuery(qk.aiTools(orgId), () => wrap(async () => client.tally.listTools(orgId)));
  const [title, setTitle] = React.useState("");
  const [summary, setSummary] = React.useState("");
  const [toolId, setToolId] = React.useState("");
  const [dueDays, setDueDays] = React.useState("30");
  const [recurrence, setRecurrence] = React.useState("12");
  const [passMark, setPassMark] = React.useState("80");
  const [quizText, setQuizText] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const quiz = parseQuizText(quizText);
    if (!quiz.ok) {
      toast({ kind: "error", title: "Check the quiz", description: quiz.error });
      return;
    }
    setBusy(true);
    const r = await wrap(async () =>
      client.tally.createCourse(orgId, {
        title,
        summary,
        toolId: toolId || null,
        dueDays: Number(dueDays),
        recurrenceMonths: Number(recurrence),
        quiz: quiz.quiz,
        passMarkPct: quiz.quiz ? Number(passMark) : null,
      }),
    );
    setBusy(false);
    if (!r.ok) {
      toast({ kind: "error", title: "Could not create the course", description: r.error.message });
      return;
    }
    toast({ kind: "success", title: "Course created", description: "Upload its material, then publish it to assign it." });
    onDone();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">New course</CardTitle>
        <CardDescription>A draft until you publish it. Upload the material on the course page.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit}>
          <label className={FIELD} htmlFor="title">Title</label>
          <Input id="title" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
          <label className={FIELD} htmlFor="summary">Summary</label>
          <Textarea id="summary" value={summary} onChange={(e) => setSummary(e.target.value)} />
          <label className={FIELD} htmlFor="tool">For the users of</label>
          <select id="tool" className={SELECT} value={toolId} onChange={(e) => setToolId(e.target.value)}>
            <option value="">Everyone (no single tool)</option>
            {(tools.data?.tools ?? []).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={FIELD} htmlFor="due">Due after (days)</label>
              <Input id="due" type="number" min={1} max={365} value={dueDays} onChange={(e) => setDueDays(e.target.value)} />
            </div>
            <div>
              <label className={FIELD} htmlFor="rec">Repeat every (months, 0 = once)</label>
              <Input id="rec" type="number" min={0} max={36} value={recurrence} onChange={(e) => setRecurrence(e.target.value)} />
            </div>
            <div>
              <label className={FIELD} htmlFor="pass">Pass mark (%)</label>
              <Input id="pass" type="number" min={1} max={100} value={passMark} onChange={(e) => setPassMark(e.target.value)} />
            </div>
          </div>
          <label className={FIELD} htmlFor="quiz">Quiz (optional)</label>
          <Textarea
            id="quiz"
            rows={6}
            placeholder={"May customer data go into an unapproved tool?\nYes\n*No\n\nWho answers for a tool in the register?\n*Its owner\nThe vendor"}
            value={quizText}
            onChange={(e) => setQuizText(e.target.value)}
          />
          <p className="mt-1 text-xs text-muted-foreground">One question per block: the prompt, then one option per line; mark the correct one with *.</p>
          <div className="mt-4 flex gap-2">
            <Button type="submit" disabled={busy}>Create course</Button>
            <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
