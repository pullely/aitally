"use client";

import * as React from "react";
import { GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/lib/session";
import { useApiQuery, qk } from "@/lib/query";
import { wrap } from "@/lib/api";
import type { MyTrainingItem } from "@saas/contracts/tally";

/**
 * My training (AT2): the signed-in person's own assignments across every
 * organization they belong to. Open the material (its SHA-256 is kept), take
 * the quiz or confirm, and the completion is recorded against that version.
 */
export default function MyTrainingPage() {
  const { client } = useSession();
  const mine = useApiQuery(qk.myTraining(), () => wrap(async () => client.tally.myTraining()));
  const items = mine.data?.assignments ?? [];
  const open = items.filter((a) => a.status === "open");
  const done = items.filter((a) => a.status !== "open");

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">My training</h1>
        <p className="text-sm text-muted-foreground">The AI training your organizations have assigned you.</p>
      </header>
      {mine.loading ? (
        <Skeleton className="h-32 w-full" />
      ) : mine.error ? (
        <p className="text-sm text-destructive">{mine.error.message}</p>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center py-10 text-center text-sm text-muted-foreground">
          <GraduationCap className="mb-3 h-8 w-8 text-primary" />
          Nothing assigned to you.
        </div>
      ) : (
        <>
          {open.map((a) => (
            <OpenAssignment key={a.id} item={a} onDone={mine.reload} />
          ))}
          {done.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Completed</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                {done.map((a) => (
                  <div key={a.id}>
                    {a.courseTitle} ({a.orgName}), cycle {a.cycle}: {a.status}
                    {a.completedAt ? ` on ${a.completedAt.slice(0, 10)}` : ""}
                    {a.scorePct !== null ? `, ${a.scorePct}%` : ""}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function OpenAssignment({ item, onDone }: { item: MyTrainingItem; onDone: () => void }) {
  const { client, token } = useSession();
  const { toast } = useToast();
  const [answers, setAnswers] = React.useState<number[]>(() => (item.quiz ?? []).map(() => -1));
  const [openedSha, setOpenedSha] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function openMaterial() {
    if (!item.material) return;
    const url = client.tally.materialUrl(item.orgId, item.courseId, item.material.id);
    const res = await fetch(url, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      toast({ kind: "error", title: "Could not open the material" });
      return;
    }
    setOpenedSha(res.headers.get("x-content-sha256"));
    const blobUrl = URL.createObjectURL(await res.blob());
    window.open(blobUrl, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  }

  async function complete() {
    setBusy(true);
    const r = await wrap(async () =>
      client.tally.complete(item.orgId, item.id, {
        ...(item.quiz ? { answers } : {}),
        ...(openedSha ? { materialSha256: openedSha } : {}),
      }),
    );
    setBusy(false);
    if (!r.ok) {
      toast({ kind: "error", title: "Could not record it", description: r.error.message });
      return;
    }
    if (!r.data.attempt.passed) {
      toast({ kind: "error", title: `${r.data.attempt.scorePct}%: not passed yet`, description: `The pass mark is ${item.passMarkPct}%. Try again.` });
      return;
    }
    toast({ kind: "success", title: "Completed", description: "Your completion is recorded." });
    onDone();
  }

  const ready = !item.quiz || answers.every((a) => a >= 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{item.courseTitle}</CardTitle>
        <CardDescription className={item.overdue ? "text-destructive" : undefined}>
          {item.orgName} · due {item.dueOn}
          {item.overdue ? " (overdue)" : ""}
          {item.cycle > 1 ? ` · refresher, cycle ${item.cycle}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button variant="outline" onClick={openMaterial} disabled={!item.material}>
          {item.material ? `Open the material (v${item.material.version}, ${item.material.filename})` : "No material yet"}
        </Button>
        {item.quiz?.map((q, qi) => (
          <fieldset key={qi} className="rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">{qi + 1}. {q.prompt}</legend>
            {q.options.map((o, oi) => (
              <label key={oi} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={`${item.id}-${qi}`}
                  checked={answers[qi] === oi}
                  onChange={() => setAnswers((prev) => prev.map((v, i) => (i === qi ? oi : v)))}
                />
                {o}
              </label>
            ))}
          </fieldset>
        ))}
        <Button onClick={complete} disabled={busy || !ready || !item.material}>
          {item.quiz ? "Submit answers" : "I have read it"}
        </Button>
      </CardContent>
    </Card>
  );
}
