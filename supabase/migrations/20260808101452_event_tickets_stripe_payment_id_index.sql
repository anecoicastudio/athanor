-- Index the webhook's reverse lookup: charge.refunded / charge.dispute.created revoke the
-- ticket bought by a charge (stripe-webhook/handlers.ts, revokeTicket) by matching
-- event_tickets.stripe_payment_id — a column that until now had no index, so every reversal
-- seq-scanned the table. The revocation is a single guarded UPDATE … WHERE stripe_payment_id
-- = $1 AND status IN ('paid','checked_in'); partial on those statuses since a reversal can
-- only ever match a live ticket.
create index event_tickets_by_stripe_payment_id
  on public.event_tickets (stripe_payment_id)
  where status in ('paid', 'checked_in');
