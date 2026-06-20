import { type Report, reportSchema, type ReportInput } from '@athanor/schemas';
import type { AthanorClient } from './client';

export const reportKeys = {
  all: ['reports'] as const,
  mine: () => [...reportKeys.all, 'mine'] as const, // reporter sees own submitted reports' existence, NOT verdicts
};

/**
 * File a misconduct report. reporter_id defaults to auth.uid() and status defaults to 'open'
 * server-side; RLS WITH CHECK pins both (a reporter can't forge another's report or pre-set a
 * verdict). The reporter never sees the outcome — no penalty/verdict is surfaced here (rule #1:
 * the −50..−200 Aura penalty on an upheld report is the M6 engine's job, server-only).
 */
export async function submitReport(client: AthanorClient, input: ReportInput): Promise<Report> {
  const { data, error } = await client
    .from('reports')
    .insert({
      target_type: input.targetType,
      target_id: input.targetId ?? null,
      category: input.category,
      note: input.note?.trim() || null,
    })
    .select('id, reporter_id, target_type, target_id, category, note, status, created_at')
    .single();
  if (error) throw error;
  return reportSchema.parse(data);
}

export type { Report };
