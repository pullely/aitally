/**
 * The course quiz as plain text, for the console's course form (AT2).
 *
 * Dependency-free so it is unit-testable. One question per block, blocks
 * separated by a blank line; the first line is the prompt, every further line
 * an option, and the correct option starts with `*`:
 *
 *   May customer data go into an unapproved tool?
 *   Yes
 *   *No
 */
import type { TrainingQuizQuestion } from "@saas/contracts/tally";

export type QuizParse = { ok: true; quiz: TrainingQuizQuestion[] | null } | { ok: false; error: string };

export function parseQuizText(text: string): QuizParse {
  const blocks = text
    .split(/\n\s*\n/)
    .map((b) => b.split("\n").map((l) => l.trim()).filter((l) => l.length > 0))
    .filter((b) => b.length > 0);
  if (blocks.length === 0) return { ok: true, quiz: null };
  const quiz: TrainingQuizQuestion[] = [];
  for (const [i, lines] of blocks.entries()) {
    const [prompt, ...rest] = lines as [string, ...string[]];
    if (rest.length < 2) return { ok: false, error: `Question ${i + 1} needs at least two options` };
    const correct = rest.findIndex((o) => o.startsWith("*"));
    if (correct < 0 || rest.filter((o) => o.startsWith("*")).length > 1) {
      return { ok: false, error: `Mark exactly one option of question ${i + 1} with *` };
    }
    quiz.push({ prompt, options: rest.map((o) => o.replace(/^\*\s*/, "")), correct });
  }
  return { ok: true, quiz };
}

export function formatQuizText(quiz: readonly TrainingQuizQuestion[] | null): string {
  if (!quiz) return "";
  return quiz
    .map((q) => [q.prompt, ...q.options.map((o, i) => (i === q.correct ? `*${o}` : o))].join("\n"))
    .join("\n\n");
}

/** "12 of 14 assigned staff completed" — a record, never a verdict. */
export function completionLine(counts: { total: number; completed: number }): string {
  if (counts.total === 0) return "Not assigned yet";
  return `${counts.completed} of ${counts.total} assigned completed`;
}
