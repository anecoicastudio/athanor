import { cn, Text, View } from '@/tw';

/**
 * Static read-mode tag — a fact, not a control. Quiet hairline pill.
 *
 * Two jobs, two tones. The default (`text-foreground`) is for tags that ARE the payload of
 * their section — the identity/seeking tags under a SectionLabel on Profilo. `quiet`
 * (`text-muted-foreground`) is for tags that ANNOTATE something else: they must never outrank
 * the content they label. Passing the wrong one inverts the row's hierarchy — a metadata pill
 * reading brighter than the dream/message/title it sits beside.
 *
 * `quiet` is `muted-foreground`, NOT `faint`, and the reason is compositing: this pill's
 * `bg-raise-2` usually sits inside a `bg-raise` row (SuggestionRow, IncomingOfferRow), so the
 * backdrop is raise-2 OVER raise over the canvas = ~rgb(35,35,49) — not the bare-canvas stack
 * the 4.69:1 figure in tokens.ts certifies. `faint` on the nested stack is 4.22:1, under the
 * 4.5 floor for 13px text. `muted-foreground` is 5.79:1 there (6.43:1 on the bare-canvas
 * geometry BenefitRow has) and still a clear step below the `ink-2` payload beside it.
 */
export function Tag({ label, quiet = false }: { label: string; quiet?: boolean }) {
  return (
    <View className="rounded-full border border-hair bg-raise-2 px-4 py-1.5">
      <Text className={cn('text-[13px]', quiet ? 'text-muted-foreground' : 'text-foreground')}>
        {label}
      </Text>
    </View>
  );
}
