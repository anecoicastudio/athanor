'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { resolveReportInput } from '@athanor/schemas';
import { resolveReport } from '@athanor/api';
import { createAuthedClient } from '@/utils/supabase/server';

/**
 * submitVerdict — server action invoked by VerdictForm.
 *
 * Defense-in-depth: explicitly calls getUser() (never getSession) and checks
 * app_metadata.role === 'admin' before proceeding. The resolve_report RPC also
 * re-checks is_admin() server-side as a second layer.
 * No Aura path here: resolveReport calls the RPC, which delegates Aura emission
 * to the score-engine edge function (rule #1).
 */
export async function submitVerdict(formData: FormData) {
  const parsed = resolveReportInput.parse({
    reportId: String(formData.get('reportId')),
    verdict: String(formData.get('verdict')),
    resolution: String(formData.get('resolution') ?? ''),
    severity: formData.get('severity') ? String(formData.get('severity')) : undefined,
  });
  const supabase = await createAuthedClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if ((user?.app_metadata as { role?: string } | undefined)?.role !== 'admin') {
    throw new Error('Forbidden');
  }
  await resolveReport(supabase, parsed);
  revalidatePath('/admin');
  redirect('/admin?status=open');
}
