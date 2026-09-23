"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { useSession } from "@/lib/session";
import { useToast } from "@/components/ui/toast";
import { wrap } from "@/lib/api";
import {
  AI_DATA_CATEGORIES,
  AI_DATA_CATEGORY_LABELS,
  AI_RISK_LEVELS,
  AI_RISK_LEVEL_LABELS,
  AI_TOOL_CATEGORIES,
  AI_TOOL_CATEGORY_LABELS,
  AI_TOOL_STATUSES,
  isRiskStatusAllowed,
  type AiDataCategory,
  type AiRiskLevel,
  type AiToolCategory,
  type AiToolStatus,
  type CreateAiToolRequest,
  type PublicAiTool,
} from "@saas/contracts/tally";

const SELECT = "h-9 w-full rounded-md border bg-background px-3 text-sm";
const FIELD = "block text-sm font-medium mt-3 mb-1";

interface FormState {
  name: string;
  vendor: string;
  websiteUrl: string;
  category: AiToolCategory;
  purpose: string;
  dataCategories: AiDataCategory[];
  riskLevel: AiRiskLevel;
  status: AiToolStatus;
  ownerEmail: string;
  usersDescription: string;
  reviewIntervalMonths: string;
  notes: string;
}

function initial(tool: PublicAiTool | null): FormState {
  return {
    name: tool?.name ?? "",
    vendor: tool?.vendor ?? "",
    websiteUrl: tool?.websiteUrl ?? "",
    category: tool?.category ?? "general_assistant",
    purpose: tool?.purpose ?? "",
    dataCategories: tool?.dataCategories ?? [],
    riskLevel: tool?.riskLevel ?? "unassessed",
    status: tool?.status ?? "proposed",
    ownerEmail: tool?.ownerEmail ?? "",
    usersDescription: tool?.usersDescription ?? "",
    reviewIntervalMonths: String(tool?.reviewIntervalMonths ?? 12),
    notes: tool?.notes ?? "",
  };
}

/**
 * Register a tool (tool = null) or edit one. The register records the
 * company's own classification; the form never suggests a risk level.
 */
export function ToolForm({
  orgId,
  tool,
  onDone,
  onCancel,
}: {
  orgId: string;
  tool: PublicAiTool | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { client } = useSession();
  const { toast } = useToast();
  const [form, setForm] = React.useState<FormState>(() => initial(tool));
  const [busy, setBusy] = React.useState(false);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const toggle = (c: AiDataCategory) =>
    set("dataCategories", form.dataCategories.includes(c) ? form.dataCategories.filter((x) => x !== c) : [...form.dataCategories, c]);
  const riskClash = !isRiskStatusAllowed(form.riskLevel, form.status);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const body: CreateAiToolRequest = {
      name: form.name,
      vendor: form.vendor,
      websiteUrl: form.websiteUrl.trim() || null,
      category: form.category,
      purpose: form.purpose,
      dataCategories: form.dataCategories,
      riskLevel: form.riskLevel,
      status: form.status,
      ownerEmail: form.ownerEmail,
      usersDescription: form.usersDescription,
      reviewIntervalMonths: Number(form.reviewIntervalMonths),
      notes: form.notes,
    };
    setBusy(true);
    const r = await wrap(async () =>
      tool ? client.tally.updateTool(orgId, tool.id, body) : client.tally.createTool(orgId, body),
    );
    setBusy(false);
    if (!r.ok) {
      toast({ kind: "error", title: "Could not save the tool", description: r.error.message });
      return;
    }
    toast({
      kind: "success",
      title: tool ? "Tool updated" : "Tool registered",
      ...(r.data.ownerNotified ? { description: `${form.ownerEmail} was told they own it.` } : {}),
    });
    onDone();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{tool ? `Edit ${tool.name}` : "Register an AI tool"}</CardTitle>
        <CardDescription>
          What the tool is, what your staff use it for, which data reaches it, and who answers for it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="grid max-w-3xl gap-x-4 sm:grid-cols-2">
          <div>
            <label className={FIELD} htmlFor="t-name">Tool</label>
            <Input id="t-name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="ChatGPT Team" required />
          </div>
          <div>
            <label className={FIELD} htmlFor="t-vendor">Vendor</label>
            <Input id="t-vendor" value={form.vendor} onChange={(e) => set("vendor", e.target.value)} placeholder="OpenAI" />
          </div>
          <div>
            <label className={FIELD} htmlFor="t-category">Kind of tool</label>
            <select id="t-category" className={SELECT} value={form.category} onChange={(e) => set("category", e.target.value as AiToolCategory)}>
              {AI_TOOL_CATEGORIES.map((c) => (
                <option key={c} value={c}>{AI_TOOL_CATEGORY_LABELS[c]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={FIELD} htmlFor="t-url">Website (https)</label>
            <Input id="t-url" value={form.websiteUrl} onChange={(e) => set("websiteUrl", e.target.value)} placeholder="https://" />
          </div>
          <div className="sm:col-span-2">
            <label className={FIELD} htmlFor="t-purpose">What it is used for</label>
            <Textarea id="t-purpose" rows={2} value={form.purpose} onChange={(e) => set("purpose", e.target.value)} required />
          </div>
          <fieldset className="sm:col-span-2">
            <legend className={FIELD}>Data that reaches it</legend>
            <div className="grid gap-1 sm:grid-cols-2">
              {AI_DATA_CATEGORIES.map((c) => (
                <label key={c} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.dataCategories.includes(c)} onChange={() => toggle(c)} />
                  {AI_DATA_CATEGORY_LABELS[c]}
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label className={FIELD} htmlFor="t-risk">Risk level (your classification)</label>
            <select id="t-risk" className={SELECT} value={form.riskLevel} onChange={(e) => set("riskLevel", e.target.value as AiRiskLevel)}>
              {AI_RISK_LEVELS.map((r) => (
                <option key={r} value={r}>{AI_RISK_LEVEL_LABELS[r]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={FIELD} htmlFor="t-status">Status</label>
            <select id="t-status" className={SELECT} value={form.status} onChange={(e) => set("status", e.target.value as AiToolStatus)}>
              {AI_TOOL_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          {riskClash && (
            <p className="text-sm text-destructive sm:col-span-2">
              A prohibited practice can only be recorded on a blocked or retired tool.
            </p>
          )}
          <div>
            <label className={FIELD} htmlFor="t-owner">Accountable owner (email)</label>
            <Input id="t-owner" type="email" value={form.ownerEmail} onChange={(e) => set("ownerEmail", e.target.value)} required />
          </div>
          <div>
            <label className={FIELD} htmlFor="t-interval">Review every (months)</label>
            <Input
              id="t-interval"
              type="number"
              min={1}
              max={24}
              value={form.reviewIntervalMonths}
              onChange={(e) => set("reviewIntervalMonths", e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={FIELD} htmlFor="t-users">Who uses it</label>
            <Input id="t-users" value={form.usersDescription} onChange={(e) => set("usersDescription", e.target.value)} placeholder="Sales and support, about 14 people" />
          </div>
          <div className="sm:col-span-2">
            <label className={FIELD} htmlFor="t-notes">Notes</label>
            <Textarea id="t-notes" rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
          <div className="mt-5 flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={busy || riskClash}>{busy ? "Saving…" : tool ? "Save changes" : "Register tool"}</Button>
            <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
