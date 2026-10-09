import { useEffect, useRef, useState } from 'react';
import { CITY_GEOHASH_PRECISION, encodeGeohash } from '@athanor/core';
import { t } from '@athanor/i18n';
import type { CitySuggestion, Locale } from '@athanor/schemas';
import { Text, View } from '@/tw';
import { Field } from '@/components/Field';
import { Row } from '@/components/Row';
import { RowGroup } from '@/components/RowGroup';
import { citySearchAvailable, searchCities } from '@/lib/city-search';

/**
 * City field of the edit form (#149): typed-text search over Mapbox place
 * suggestions, free text as the fallback. Picking a suggestion stores the name
 * plus a precision-5 geohash of its coordinates; typing anything afterwards
 * clears the geohash — the text no longer matches the picked place, and a
 * free-text city deliberately stores NO geohash (the proximity term skips it).
 * Device location is never read.
 *
 * The suggestions are the rows of one group under the field. They answer TYPING: nothing is
 * looked up until the member changes the text, so the editor does not open with a list under a
 * city that was saved long ago (it did until 2026-10-05).
 */
export function CityPicker({
  city,
  onChange,
  locale,
}: {
  city: string;
  onChange: (city: string, geohash: string | null) => void;
  locale: Locale;
}) {
  // The result carries the query it answers, so "these suggestions are stale" is a comparison
  // during render rather than a `setState([])` in an effect (#691) — a too-short query, a
  // picked value and an in-flight debounce all stop showing the previous city's list without
  // anything having to clear it.
  const [result, setResult] = useState<{ query: string; items: CitySuggestion[] }>({
    query: '',
    items: [],
  });
  const suggestions = result.query === city ? result.items : [];
  // Suppresses the lookup for the change that a pick itself causes.
  const picked = useRef(false);
  // Set by the first keystroke. The stored city arrives as a prop on mount and is not a query.
  const edited = useRef(false);

  useEffect(() => {
    if (!edited.current) return;
    if (picked.current) {
      picked.current = false;
      return;
    }
    if (city.trim().length < 2 || !citySearchAvailable()) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchCities(city, locale, controller.signal)
        .then((items) => setResult({ query: city, items }))
        // Search is a convenience, not a gate: on any failure the member
        // simply keeps their typed text (the free-text path).
        .catch(() => setResult({ query: city, items: [] }));
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [city, locale]);

  const pick = (s: CitySuggestion) => {
    picked.current = true;
    // Cleared outright rather than left to `onChange` moving `city` off the query: type
    // «Milano» in full and tap the identically-named suggestion and `city` does not move at
    // all, so a derived comparison would keep the list open under the member's finger.
    setResult({ query: '', items: [] });
    onChange(s.name, encodeGeohash(s.lat, s.lng, CITY_GEOHASH_PRECISION));
  };

  return (
    <View className="gap-2">
      <Field
        maxLength={80}
        placeholder={t('profile.city.empty', locale)}
        value={city}
        onChangeText={(text) => {
          edited.current = true;
          onChange(text, null);
        }}
      />
      {suggestions.length > 0 ? (
        <RowGroup>
          {suggestions.map((s) => (
            <Row
              key={`${s.name}-${s.lat}-${s.lng}`}
              title={s.name}
              description={s.context || undefined}
              // Two places can share a name; the second line is what tells them apart.
              accessibilityLabel={[s.name, s.context].filter(Boolean).join(', ')}
              showChevron={false}
              onPress={() => pick(s)}
            />
          ))}
        </RowGroup>
      ) : null}
      <Text className="type-small text-muted-foreground">{t('profile.city.hint', locale)}</Text>
    </View>
  );
}
