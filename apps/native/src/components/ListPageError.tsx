import { Text, View } from '@/tw';
import { Button } from '@/components/Button';

/**
 * The foot of a paged list whose read failed with rows already on screen (a later page, or a
 * refetch): the reason and a retry, under the rows (#921, 2026-10-07). A list that keeps its
 * loading, empty and error arms in `ListEmptyComponent` renders none of them once it holds a
 * row, so without this a failed later page says nothing. With no row in hand it draws nothing:
 * that arm is `ListState`'s.
 *
 * `(modal)/favor` wrote the same block inline first; this is that block for the lists that
 * came after it.
 */
export function ListPageError({
  query,
  hasRows,
  label,
  retryLabel,
}: {
  query: {
    isError: boolean;
    isFetchNextPageError: boolean;
    fetchNextPage: () => unknown;
    refetch: () => unknown;
  };
  hasRows: boolean;
  label: string;
  retryLabel: string;
}) {
  if (!query.isError || !hasRows) return null;
  return (
    <View className="items-center gap-2 pt-4">
      <Text className="text-center type-small text-muted-foreground">{label}</Text>
      <Button
        label={retryLabel}
        variant="ghost"
        onPress={() => void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch())}
      />
    </View>
  );
}
