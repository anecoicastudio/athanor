import { useEffect, useRef, useState } from 'react';
import { CITY_GEOHASH_PRECISION, encodeGeohash } from '@athanor/core';
import { t } from '@athanor/i18n';
import type { CitySuggestion, Locale } from '@athanor/schemas';
import { Pressable, Text, TextInput, View } from '@/tw';
import { citySearchAvailable, searchCities } from '@/lib/city-search';

/**
 * City field of the edit form (#149): typed-text search over Mapbox place
 * suggestions, free text as the fallback. Picking a suggestion stores the name
 * plus a precision-5 geohash of its coordinates; typing anything afterwards
 * clears the geohash — the text no longer matches the picked place, and a
 * free-text city deliberately stores NO geohash (the proximity term skips it).
 * Device location is never read.
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
  const [suggestions, setSuggestions] = useState<CitySuggestion[]>([]);
  // Suppresses the lookup for the change that a pick itself causes.
  const picked = useRef(false);

  useEffect(() => {
    if (picked.current) {
      picked.current = false;
      return;
    }
    if (city.trim().length < 2 || !citySearchAvailable()) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchCities(city, locale, controller.signal)
        .then(setSuggestions)
        // Search is a convenience, not a gate: on any failure the member
        // simply keeps their typed text (the free-text path).
        .catch(() => setSuggestions([]));
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [city, locale]);

  const pick = (s: CitySuggestion) => {
    picked.current = true;
    setSuggestions([]);
    onChange(s.name, encodeGeohash(s.lat, s.lng, CITY_GEOHASH_PRECISION));
  };

  return (
    <View className="gap-2">
      <TextInput
        className="rounded-hero border border-hair bg-raise px-5 py-4 text-foreground"
        maxLength={80}
        placeholder={t('profile.city.empty', locale)}
        value={city}
        onChangeText={(text) => onChange(text, null)}
      />
      {suggestions.length > 0 ? (
        <View className="rounded-hero border border-hair bg-raise">
          {suggestions.map((s, i) => (
            <Pressable
              key={`${s.name}-${s.lat}-${s.lng}`}
              accessibilityRole="button"
              className={`px-5 py-3 ${i > 0 ? 'border-t border-hair' : ''}`}
              onPress={() => pick(s)}
            >
              <Text className="text-foreground">{s.name}</Text>
              {s.context ? (
                <Text className="text-[13px] text-muted-foreground">{s.context}</Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}
      <Text className="text-[13px] text-muted-foreground">{t('profile.city.hint', locale)}</Text>
    </View>
  );
}
