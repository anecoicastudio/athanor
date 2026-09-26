import { queryOptions, useQuery } from '@tanstack/react-query';
import { gdprKeys, getLatestExportJob } from '@athanor/api';
import { supabase } from '@/lib/supabase';
import { useRefetchOnForeground } from './use-refetch-on-foreground';

/**
 * The member's latest GDPR export job. The export screen and the delete-account gate both read
 * this one cache entry, and the request mutation invalidates `gdprKeys.exportStatus()`.
 *
 * The job turns ready on a nightly server pass, so the status changes while nobody is looking:
 * `refetchOnMount: 'always'` re-reads on every entry (the delete gate's rule since #735), and
 * `useExportJob` also re-reads when the app returns to the foreground (#879). The persisted copy
 * stays — the export screen has no loading branch, so dropping it would flash an enabled request
 * button on a cold start instead of the last known status.
 */
export function exportJobQuery() {
  return queryOptions({
    queryKey: gdprKeys.exportStatus(),
    queryFn: () => getLatestExportJob(supabase),
    refetchOnMount: 'always',
  });
}

export function useExportJob() {
  const job = useQuery(exportJobQuery());
  useRefetchOnForeground(job.refetch);
  return job;
}
