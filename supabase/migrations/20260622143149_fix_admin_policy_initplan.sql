-- I-1 fix: wrap athanor.is_admin() in (select …) so RLS evaluates it once per
-- statement (initplan), not per row — matches the project's (select auth.uid()) rule (#2).
alter policy "reports_select_admin" on public.reports
  using ((select athanor.is_admin()));
alter policy "audit_log_select_admin" on public.audit_log
  using ((select athanor.is_admin()));
