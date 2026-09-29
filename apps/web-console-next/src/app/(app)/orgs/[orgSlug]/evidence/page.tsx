"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { OrgScope } from "@/components/shell/org-scope";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/lib/session";
import { useApiQuery, qk } from "@/lib/query";
import { wrap } from "@/lib/api";
import type { CreateEvidencePackRequest, EvidencePackScope } from "@saas/contracts/tally";

const SELECT = "h-9 w-full rounded-md border bg-background px-3 text-sm";

export default function EvidencePage() {
  const params = useParams<{ orgSlug: string }>();
  const slug = params?.orgSlug ?? "";
  return <OrgScope slug={slug}>{(org) => <Inner orgId={org.id} />}</OrgScope>;
}

/** Download a file behind the bearer token (a plain <a href> would not carry it). */
function useAuthedDownload() {
  const { token } = useSession();
  return React.useCallback(
    async (url: string, filename: string) => {
      const res = await fetch(url, { headers: token ? { authorization: `Bearer ${token}` } : {} });
      if (!res.ok) return false;
      const href = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = href;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
      return true;
    },
    [token],
  );
}

function Inner({ orgId }: { orgId: string }) {
  const { client } = useSession();
  const { toast } = useToast();
  const download = useAuthedDownload();
  const packs = useApiQuery(qk.evidencePacks(orgId), () => wrap(async () => client.tally.listEvidencePacks(orgId)));
  const tools = useApiQuery(qk.aiTools(orgId), () => wrap(async () => client.tally.listTools(orgId)));
  const [scope, setScope] = React.useState<EvidencePackScope>("org");
  const [subject, setSubject] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function build() {
    const body: CreateEvidencePackRequest = scope === "org" ? { scope } : { scope, subject };
    setBusy(true);
    const r = await wrap(async () => client.tally.createEvidencePack(orgId, body));
    setBusy(false);
    if (!r.ok) {
      toast({ kind: "error", title: "Could not build the pack", description: r.error.message });
      return;
    }
    toast({ kind: "success", title: "Evidence pack built", description: `manifest.json SHA-256 ${r.data.pack.manifestSha256}` });
    packs.reload();
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Evidence</h1>
        <p className="text-sm text-muted-foreground">
          An evidence pack is a dated, hashed export of the register, its reviews and the training record, stored so it can never be
          changed. Build a new one whenever you are asked; earlier packs stay as they were.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Build a pack</CardTitle>
          <CardDescription>register.csv, reviews.csv, training-records.csv, summary.pdf and manifest.json (the SHA-256 of each).</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <select aria-label="Scope" className={SELECT} value={scope} onChange={(e) => { setScope(e.target.value as EvidencePackScope); setSubject(""); }}>
            <option value="org">The whole organization</option>
            <option value="employee">One employee</option>
            <option value="tool">One AI tool</option>
          </select>
          {scope === "employee" && (
            <Input aria-label="Employee email" placeholder="name@company.example" value={subject} onChange={(e) => setSubject(e.target.value)} />
          )}
          {scope === "tool" && (
            <select aria-label="Tool" className={SELECT} value={subject} onChange={(e) => setSubject(e.target.value)}>
              <option value="">Choose a tool</option>
              {(tools.data?.tools ?? []).map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          )}
          <Button onClick={build} disabled={busy || (scope !== "org" && !subject)}>Build evidence pack</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Packs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {packs.loading ? (
            <Skeleton className="h-24 w-full" />
          ) : (packs.data?.packs ?? []).length === 0 ? (
            <div className="flex flex-col items-center py-8 text-center text-sm text-muted-foreground">
              <ShieldCheck className="mb-3 h-8 w-8 text-primary" />
              No packs yet.
            </div>
          ) : (
            packs.data!.packs.map((p) => (
              <div key={p.id} className="rounded-md border p-3">
                <div className="text-sm font-medium">
                  {p.scope === "org" ? "Organization" : p.scope === "employee" ? `Employee ${p.subject}` : `Tool ${p.subject}`} · as of{" "}
                  {p.asOf.slice(0, 16).replace("T", " ")} UTC
                </div>
                <div className="font-mono text-xs text-muted-foreground">manifest SHA-256 {p.manifestSha256}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {p.files.map((f) => (
                    <Button
                      key={f.name}
                      variant="outline"
                      size="sm"
                      title={`SHA-256 ${f.sha256}`}
                      onClick={() => download(client.tally.evidencePackFileUrl(orgId, p.id, f.name), `${p.id}-${f.name}`)}
                    >
                      {f.name}
                    </Button>
                  ))}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
