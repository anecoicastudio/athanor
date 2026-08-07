import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  confirmHelpComplete,
  getActiveDream,
  getProfileById,
  listIncomingHelps,
  listMilestones,
  respondToHelp,
  softDeleteMilestone,
  updateMilestoneStatus,
} from '@athanor/api';
import type { Help, Milestone } from '@athanor/schemas';
import { devWarn } from '@/lib/log';
import { supabase } from '@/lib/supabase';

export type OwnDream = ReturnType<typeof useOwnDream>;

/**
 * Own active dream + tappe + owner-side «Aiuti in arrivo» for Profilo (PRD §4.2,
 * M2/M5). Owns the focus-driven fetch and the optimistic tappa/help mutations
 * (rollback-by-refetch). Aura/Stars cache invalidation stays in the route.
 */
export function useOwnDream(userId: string) {
  const [dreamText, setDreamText] = useState<string | null>(null);
  const [dreamId, setDreamId] = useState<string | null>(null);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [mutatingMilestoneId, setMutatingMilestoneId] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<Help[]>([]);
  const [helperNames, setHelperNames] = useState<Record<string, string>>({});
  const [mutatingHelpId, setMutatingHelpId] = useState<string | null>(null);
  const [flashMilestoneId, setFlashMilestoneId] = useState<string | null>(null);

  // Refetch the active dream + its tappe whenever Profilo regains focus (e.g. after editing).
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      getActiveDream(supabase, userId)
        .then(async (d) => {
          if (cancelled) return;
          setDreamText(d?.text ?? null);
          setDreamId(d?.id ?? null);
          if (d?.id) {
            const tappe = await listMilestones(supabase, d.id);
            if (cancelled) return;
            setMilestones(tappe);
            // Owner-side «Aiuti in arrivo»: offers on my tappe + their helper display names.
            const offers = await listIncomingHelps(
              supabase,
              tappe.map((m) => m.id),
            );
            if (cancelled) return;
            setIncoming(offers);
            // resolve distinct helper names (best-effort; fall back to a short id)
            const ids = [...new Set(offers.map((o) => o.helper_id))];
            const names: Record<string, string> = {};
            for (const hid of ids) {
              try {
                const p = await getProfileById(supabase, hid);
                names[hid] = p?.handle ?? hid.slice(0, 8);
              } catch (e) {
                devWarn('[profile] helper name lookup', e);
                names[hid] = hid.slice(0, 8);
              }
            }
            if (!cancelled) setHelperNames(names);
          } else {
            setMilestones([]);
            setIncoming([]);
          }
        })
        .catch((e) => {
          // leave dream unset; the empty state is the safe default
          devWarn('[profile] dream load', e);
        });
      return () => {
        cancelled = true;
      };
    }, [userId]),
  );

  const refetchMilestones = useCallback(async () => {
    if (!dreamId) return;
    try {
      setMilestones(await listMilestones(supabase, dreamId));
    } catch (e) {
      devWarn('[profile] refetchMilestones', e);
      // keep the optimistic state; a later focus refetch reconciles
    }
  }, [dreamId]);

  // Reconcile «Aiuti in arrivo» after a failed respond/confirm so the optimistic flip
  // can't diverge until the next focus. Best-effort: keeps optimistic state on error.
  const refetchIncoming = useCallback(async () => {
    try {
      setIncoming(
        await listIncomingHelps(
          supabase,
          milestones.map((m) => m.id),
        ),
      );
    } catch (e) {
      devWarn('[profile] refetchIncoming', e);
      // keep the optimistic state; a later focus refetch reconciles
    }
  }, [milestones]);

  const handleMarkMilestoneDone = async (id: string) => {
    setMutatingMilestoneId(id);
    // optimistic ✓ (frontend §3.1 tappa-mutating)
    setMilestones((prev) => prev.map((m) => (m.id === id ? { ...m, status: 'done' as const } : m)));
    try {
      await updateMilestoneStatus(supabase, id, 'done');
      await refetchMilestones();
    } catch (e) {
      devWarn('[profile] markMilestoneDone', e);
      await refetchMilestones();
    } finally {
      setMutatingMilestoneId(null);
    }
  };

  const handleDeleteMilestone = async (id: string) => {
    setMutatingMilestoneId(id);
    setMilestones((prev) => prev.filter((m) => m.id !== id)); // optimistic remove
    try {
      await softDeleteMilestone(supabase, id);
      await refetchMilestones();
    } catch (e) {
      devWarn('[profile] deleteMilestone', e);
      await refetchMilestones();
    } finally {
      setMutatingMilestoneId(null);
    }
  };

  // Owner accepts/declines an incoming offer (optimistic; a later focus refetch reconciles).
  const handleRespond = async (id: string, status: 'accepted' | 'declined') => {
    setMutatingHelpId(id);
    setIncoming((prev) =>
      status === 'declined'
        ? prev.filter((h) => h.id !== id)
        : prev.map((h) => (h.id === id ? { ...h, status } : h)),
    );
    try {
      await respondToHelp(supabase, id, status);
    } catch (e) {
      devWarn('[profile] respondToHelp', e);
      await refetchIncoming(); // reconcile the optimistic flip on failure
    } finally {
      setMutatingHelpId(null);
    }
  };

  // Owner confirms the help is done — the +40/+10 domain event. Writes NO aura_* (rule #1):
  // the confirm_milestone_help RPC atomically flips milestone_helps + dream_milestones; M6 scores.
  const handleConfirmHelp = async (helpId: string, milestoneId: string) => {
    setMutatingHelpId(helpId);
    setFlashMilestoneId(milestoneId);
    // optimistic: mark the tappa done + the offer completed
    setMilestones((prev) =>
      prev.map((m) => (m.id === milestoneId ? { ...m, status: 'done' as const } : m)),
    );
    setIncoming((prev) =>
      prev.map((h) => (h.id === helpId ? { ...h, status: 'completed' as const } : h)),
    );
    try {
      await confirmHelpComplete(supabase, helpId);
      await refetchMilestones();
    } catch (e) {
      devWarn('[profile] confirmHelp', e);
      await refetchMilestones();
      await refetchIncoming(); // reconcile the optimistic completed-flip on failure
    } finally {
      setMutatingHelpId(null);
      setTimeout(() => setFlashMilestoneId(null), 700);
    }
  };

  return {
    dreamText,
    dreamId,
    milestones,
    mutatingMilestoneId,
    incoming,
    helperNames,
    mutatingHelpId,
    flashMilestoneId,
    handleMarkMilestoneDone,
    handleDeleteMilestone,
    handleRespond,
    handleConfirmHelp,
  };
}
