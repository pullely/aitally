/**
 * Static email templates for the notifications worker.
 *
 * Spec 14 allows V1 templates to be static files as long as template
 * versions remain traceable — these renderers are the V1 "static files"
 * form, keyed by the same `templateKey` strings the calling workers pass
 * to POST /v1/notifications.
 *
 * Every substitution is HTML-escaped before it reaches the html body, so a
 * hostile value in `templateData` (or a recipient-controlled field such as
 * an email hint) can never inject markup. Renderers only read the fields
 * they need; unknown extra fields are ignored, and unknown template keys
 * return null so the provider can fail the send with a bounded reason
 * instead of delivering an empty message.
 */

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export type TemplateData = Record<string, string | number | boolean | null>;

export interface TemplateRenderOptions {
  /**
   * Product display name used in subjects/footers (e.g. "Aitally").
   * Falls back to neutral copy when not configured so a misconfigured
   * deployment still produces a sensible email.
   */
  brandName?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Stringify a templateData value; null/undefined render as "". */
function str(data: TemplateData, key: string): string {
  const v = data[key];
  if (v === null || v === undefined) return "";
  return String(v);
}

/**
 * Render an ISO timestamp as a human-readable UTC string. Falls back to the
 * raw value when it does not parse — a slightly ugly email beats a failed
 * send.
 */
function formatTimestamp(raw: string): string {
  if (!raw) return "";
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? raw : d.toUTCString();
}

/**
 * Shared shell so all transactional emails look consistent. Body fragments
 * passed in MUST already be escaped.
 */
function htmlShell(title: string, bodyHtml: string, footerLine: string): string {
  return [
    '<!DOCTYPE html><html><body style="margin:0;padding:0;background-color:#f4f4f7;">',
    '<div style="max-width:560px;margin:0 auto;padding:32px 24px;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;color:#1a1a2e;">',
    '<div style="background:#ffffff;border-radius:8px;padding:32px;">',
    `<h1 style="margin:0 0 16px;font-size:20px;">${title}</h1>`,
    bodyHtml,
    "</div>",
    `<p style="margin:16px 0 0;font-size:12px;color:#6b6b80;text-align:center;">${footerLine}</p>`,
    "</div></body></html>",
  ].join("");
}

type TemplateRenderer = (data: TemplateData, opts: TemplateRenderOptions) => RenderedEmail;

const renderMagicLink: TemplateRenderer = (data, opts) => {
  const code = str(data, "code");
  const expires = formatTimestamp(str(data, "expiresAt"));
  const brand = opts.brandName ?? "";
  const subject = brand ? `Your ${brand} login code` : "Your login code";
  const expiryLineText = expires ? `This code expires at ${expires}.` : "This code expires shortly.";

  const text = [
    "Use this code to finish signing in:",
    "",
    code,
    "",
    expiryLineText,
    "If you did not request this code, you can safely ignore this email.",
  ].join("\n");

  const html = htmlShell(
    "Finish signing in",
    [
      '<p style="margin:0 0 16px;font-size:14px;">Use this code to finish signing in:</p>',
      `<p style="margin:0 0 16px;font-size:28px;font-weight:700;letter-spacing:4px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(code)}</p>`,
      `<p style="margin:0 0 8px;font-size:13px;color:#6b6b80;">${escapeHtml(expiryLineText)}</p>`,
      '<p style="margin:0;font-size:13px;color:#6b6b80;">If you did not request this code, you can safely ignore this email.</p>',
    ].join(""),
    escapeHtml(brand ? `Sent by ${brand}` : "This is an automated security email."),
  );

  return { subject, html, text };
};

const renderInvitationCreated: TemplateRenderer = (data, opts) => {
  const role = str(data, "role");
  const expires = formatTimestamp(str(data, "expiresAt"));
  const brand = opts.brandName ?? "";
  const subject = brand
    ? `You have been invited to an organization on ${brand}`
    : "You have been invited to an organization";
  const roleLineText = role
    ? `You have been invited to join an organization as ${role}.`
    : "You have been invited to join an organization.";
  const expiryLineText = expires ? `The invitation expires at ${expires}.` : "";

  const text = [
    roleLineText,
    expiryLineText,
    "Sign in with this email address to view and accept the invitation.",
    "If you were not expecting this invitation, you can safely ignore this email.",
  ]
    .filter((line) => line.length > 0)
    .join("\n\n");

  const html = htmlShell(
    "You have been invited",
    [
      `<p style="margin:0 0 16px;font-size:14px;">${escapeHtml(roleLineText)}</p>`,
      expiryLineText
        ? `<p style="margin:0 0 16px;font-size:13px;color:#6b6b80;">${escapeHtml(expiryLineText)}</p>`
        : "",
      '<p style="margin:0 0 8px;font-size:14px;">Sign in with this email address to view and accept the invitation.</p>',
      '<p style="margin:0;font-size:13px;color:#6b6b80;">If you were not expecting this invitation, you can safely ignore this email.</p>',
    ].join(""),
    escapeHtml(brand ? `Sent by ${brand}` : "This is an automated email."),
  );

  return { subject, html, text };
};

const renderInvitationAccepted: TemplateRenderer = (data, opts) => {
  const role = str(data, "role");
  const brand = opts.brandName ?? "";
  const subject = brand ? `You have joined an organization on ${brand}` : "You have joined an organization";
  const bodyLineText = role
    ? `Your invitation was accepted and you are now a member with the ${role} role.`
    : "Your invitation was accepted and you are now a member of the organization.";

  const text = [
    bodyLineText,
    "If this was not you, contact your organization administrator.",
  ].join("\n\n");

  const html = htmlShell(
    "Welcome aboard",
    [
      `<p style="margin:0 0 16px;font-size:14px;">${escapeHtml(bodyLineText)}</p>`,
      '<p style="margin:0;font-size:13px;color:#6b6b80;">If this was not you, contact your organization administrator.</p>',
    ].join(""),
    escapeHtml(brand ? `Sent by ${brand}` : "This is an automated email."),
  );

  return { subject, html, text };
};

/**
 * Aitally: this person is now the accountable owner of an AI tool in the
 * company's AI register. Names the tool, what it is used for, its recorded
 * risk level and the next review date: what an owner answers for.
 */
const renderTallyToolOwnerAssigned: TemplateRenderer = (data, opts) => {
  const toolName = str(data, "toolName");
  const vendor = str(data, "vendor");
  const purpose = str(data, "purpose");
  const riskLabel = str(data, "riskLabel");
  const nextReviewOn = str(data, "nextReviewOn");
  const toolUrl = str(data, "toolUrl");
  const brand = opts.brandName ?? "";
  const named = vendor ? `${toolName} (${vendor})` : toolName;
  const subject = `You own ${toolName} in the AI register`;

  const text = [
    `You are now the accountable owner of ${named} in your company's AI register.`,
    `It is recorded as used for: ${purpose}`,
    `Recorded risk level: ${riskLabel}. Next review due on ${nextReviewOn}.`,
    ...(toolUrl ? [toolUrl] : []),
  ].join("\n\n");

  const html = htmlShell(
    `You own ${escapeHtml(toolName)}`,
    [
      `<p style="margin:0 0 16px;font-size:14px;">You are now the accountable owner of <strong>${escapeHtml(named)}</strong> in your company's AI register.</p>`,
      `<p style="margin:0 0 16px;font-size:14px;">It is recorded as used for: ${escapeHtml(purpose)}</p>`,
      `<p style="margin:0 0 16px;font-size:14px;">Recorded risk level: <strong>${escapeHtml(riskLabel)}</strong>. Next review due on <strong>${escapeHtml(nextReviewOn)}</strong>.</p>`,
      toolUrl
        ? `<p style="margin:0 0 16px;"><a href="${escapeHtml(toolUrl)}" style="display:inline-block;padding:10px 16px;background:#2f4f6b;color:#ffffff;border-radius:6px;text-decoration:none;font-size:14px;">Open the register</a></p>`
        : "",
    ].join(""),
    escapeHtml(brand ? `Sent by ${brand}` : "Sent by Aitally"),
  );

  return { subject, html, text };
};

function trainingButton(url: string, label: string): string {
  return url
    ? `<p style="margin:0 0 16px;"><a href="${escapeHtml(url)}" style="display:inline-block;padding:10px 16px;background:#2f4f6b;color:#ffffff;border-radius:6px;text-decoration:none;font-size:14px;">${escapeHtml(label)}</a></p>`
    : "";
}

/**
 * Aitally: a staff member has AI-literacy training to complete — which
 * course and by when. A later cycle of the same course (the annual
 * re-training) says so.
 */
const renderTallyTrainingAssigned: TemplateRenderer = (data, opts) => {
  const courseTitle = str(data, "courseTitle");
  const dueOn = str(data, "dueOn");
  const cycle = Number(str(data, "cycle") || "1");
  const trainingUrl = str(data, "trainingUrl");
  const brand = opts.brandName ?? "";
  const again = cycle > 1;
  const subject = again ? `Time to refresh your training: ${courseTitle}` : `Training to complete: ${courseTitle}`;
  const lead = again
    ? `It is time to take "${courseTitle}" again: your company repeats this AI training every year.`
    : `Your company has assigned you the AI training "${courseTitle}".`;
  const text = [lead, `Please complete it by ${dueOn}.`, ...(trainingUrl ? [trainingUrl] : [])].join("\n\n");
  const html = htmlShell(
    again ? "Time to refresh your training" : "Training to complete",
    [
      `<p style="margin:0 0 16px;font-size:14px;">${escapeHtml(lead)}</p>`,
      `<p style="margin:0 0 16px;font-size:14px;">Please complete it by <strong>${escapeHtml(dueOn)}</strong>.</p>`,
      trainingButton(trainingUrl, "Open my training"),
    ].join(""),
    escapeHtml(brand ? `Sent by ${brand}` : "Sent by Aitally"),
  );
  return { subject, html, text };
};

/**
 * Aitally: one rung of the training reminder ladder. The assignee hears 7, 1
 * and 0 days before the due date and on every late rung; the owner of the
 * course's tool is copied 3 and 7 days late, and the organization's owners
 * 14 days late. Each reads the same facts, addressed to their role.
 */
const renderTallyTrainingReminder: TemplateRenderer = (data, opts) => {
  const courseTitle = str(data, "courseTitle");
  const assigneeEmail = str(data, "assigneeEmail");
  const dueOn = str(data, "dueOn");
  const days = Number(str(data, "daysRemaining") || "0");
  const toolName = str(data, "toolName");
  const role = str(data, "role");
  const trainingUrl = str(data, "trainingUrl");
  const brand = opts.brandName ?? "";
  const when =
    days > 1 ? `is due in ${days} days, on ${dueOn}` : days === 1 ? `is due tomorrow, ${dueOn}` : days === 0 ? `is due today, ${dueOn}` : `was due on ${dueOn}, ${-days} days ago`;
  let subject: string;
  let lead: string;
  if (role === "assignee") {
    subject = days < 0 ? `Overdue: ${courseTitle}` : `Reminder: ${courseTitle} ${days === 0 ? "is due today" : days === 1 ? "is due tomorrow" : `is due in ${days} days`}`;
    lead = `Your AI training "${courseTitle}" ${when}.`;
  } else {
    subject = `Overdue training: ${assigneeEmail} — ${courseTitle}`;
    const why =
      role === "tool_owner"
        ? `You are receiving this as the owner of ${toolName || "the AI tool this course covers"}.`
        : "You are receiving this as an owner of the organization.";
    lead = `${assigneeEmail} has not completed the AI training "${courseTitle}", which ${when}. ${why}`;
  }
  const text = [lead, ...(trainingUrl ? [trainingUrl] : [])].join("\n\n");
  const html = htmlShell(
    days < 0 ? "Training overdue" : "Training reminder",
    [`<p style="margin:0 0 16px;font-size:14px;">${escapeHtml(lead)}</p>`, trainingButton(trainingUrl, "Open the training")].join(""),
    escapeHtml(brand ? `Sent by ${brand}` : "Sent by Aitally"),
  );
  return { subject, html, text };
};

const TEMPLATES: Record<string, TemplateRenderer> = {
  "tally.tool.owner_assigned": renderTallyToolOwnerAssigned,
  "tally.training.assigned": renderTallyTrainingAssigned,
  "tally.training.reminder": renderTallyTrainingReminder,
  "auth.magic_link": renderMagicLink,
  "invitation.created": renderInvitationCreated,
  "invitation.accepted": renderInvitationAccepted,
};

/**
 * Render the email for a template key, or null when the key has no
 * registered template. Callers (the provider adapters) MUST treat null as a
 * bounded send failure — never deliver an empty or generic body.
 */
export function renderEmailTemplate(
  templateKey: string,
  templateData: TemplateData,
  opts: TemplateRenderOptions = {},
): RenderedEmail | null {
  const renderer = TEMPLATES[templateKey];
  if (!renderer) return null;
  return renderer(templateData, opts);
}
