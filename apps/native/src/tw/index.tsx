import React from 'react';
import { useCssElement } from 'react-native-css';
import {
  View as RNView,
  Text as RNText,
  Pressable as RNPressable,
  ScrollView as RNScrollView,
  TextInput as RNTextInput,
  FlatList as RNFlatList,
  type FlatListProps as RNFlatListProps,
} from 'react-native';
import { SafeAreaView as RNSafeAreaView } from 'react-native-safe-area-context';
import { FONT_SCALE_CAP } from '@/lib/type-scale';

/** Join conditional NativeWind classes — falsy parts drop out, so call sites avoid
 *  empty-string ternaries (`cond ? 'x' : ''`) inside template literals. */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

// `ref` passes through as a regular prop (React 19), same as FlatList below — the instance is
// the native View (measureInWindow etc.).
export type ViewProps = React.ComponentProps<typeof RNView> & {
  className?: string;
  ref?: React.Ref<RNView>;
};
export const View = (props: ViewProps) => useCssElement(RNView, props, { className: 'style' });
View.displayName = 'CSS(View)';

// Default family (DESIGN §4: everything is Hanken). Precedence is stylesheet
// SOURCE ORDER in global.css — `.font-app` is defined before the font-weight
// remaps and `.font-dream`, so explicit font-* utilities on the call site win.
// Don't reorder those rules.
//
// The second default is the Dynamic Type policy (#639, DESIGN §10). RN leaves
// `maxFontSizeMultiplier` unset, which is unbounded growth — right for a box that
// can grow, a silent clip for one that cannot. Setting it HERE is what makes it a
// policy rather than 500 forgotten call sites: every Text and TextInput in the app
// arrives through these two wrappers, and `source-audit.test.ts` §30 keeps it that way
// by banning the import outright — §6 only catches an RN-imported tag that ALSO carries
// a className, so `<Text style={…}>` from `react-native` used to pass it uncapped.
//
// `=== undefined`, not `??`: a call site passing `maxFontSizeMultiplier={undefined}`
// still gets the cap, so the policy cannot be switched off by accident — but `null`
// has a MEANING in RN ("inherit from the parent Text"), and `??` would swallow it.
// That is not academic: a nested run inside a `display`-capped countdown numeral
// would have jumped back to 2x instead of inheriting its parent's 1.35. Passing an
// explicit number — one of `FONT_SCALE_CAP`'s — is how a call site opts down.
const withTextDefaults = <P extends { className?: string; maxFontSizeMultiplier?: number | null }>(
  props: P,
): P => ({
  ...props,
  className: props.className ? `font-app ${props.className}` : 'font-app',
  maxFontSizeMultiplier:
    props.maxFontSizeMultiplier === undefined ? FONT_SCALE_CAP.text : props.maxFontSizeMultiplier,
});

export type TextProps = React.ComponentProps<typeof RNText> & { className?: string };
export const Text = (props: TextProps) =>
  useCssElement(RNText, withTextDefaults(props), { className: 'style' });
Text.displayName = 'CSS(Text)';

export type PressableProps = React.ComponentProps<typeof RNPressable> & { className?: string };
// Erased generic: Pressable/ScrollView function-style props explode TS union
// inference inside useCssElement (TS2590). Public prop types stay exact.
const PressableImpl = RNPressable as unknown as React.ComponentType<Record<string, unknown>>;
export const Pressable = (props: PressableProps) =>
  useCssElement(PressableImpl, props as Record<string, unknown>, { className: 'style' });
Pressable.displayName = 'CSS(Pressable)';

// `ref` for the same reason View and FlatList declare theirs: RN's ScrollView is a class, so
// `ComponentProps` does not carry a ref, and the instance is what `scrollTo` lives on (#689).
export type ScrollViewProps = React.ComponentProps<typeof RNScrollView> & {
  className?: string;
  contentContainerClassName?: string;
  ref?: React.Ref<RNScrollView>;
};
const ScrollViewImpl = RNScrollView as unknown as React.ComponentType<Record<string, unknown>>;
export const ScrollView = (props: ScrollViewProps) =>
  useCssElement(ScrollViewImpl, props as Record<string, unknown>, {
    className: 'style',
    contentContainerClassName: 'contentContainerStyle',
  });
ScrollView.displayName = 'CSS(ScrollView)';

export type FlatListProps<ItemT> = RNFlatListProps<ItemT> & {
  ref?: React.Ref<RNFlatList<ItemT>>;
  className?: string;
  contentContainerClassName?: string;
};
const FlatListImpl = RNFlatList as unknown as React.ComponentType<Record<string, unknown>>;
export function FlatList<ItemT>(props: FlatListProps<ItemT>) {
  return useCssElement(FlatListImpl, props as unknown as Record<string, unknown>, {
    className: 'style',
    contentContainerClassName: 'contentContainerStyle',
  });
}
FlatList.displayName = 'CSS(FlatList)';

export type TextInputProps = React.ComponentProps<typeof RNTextInput> & { className?: string };
export const TextInput = (props: TextInputProps) =>
  useCssElement(RNTextInput, withTextDefaults(props), { className: 'style' });
TextInput.displayName = 'CSS(TextInput)';

// For chrome bands that own ONE safe-area edge on an overlay surface (story viewer). Whole-screen
// roots keep using the `Screen` primitive — same native per-view measurement, plus its defaults.
export type SafeAreaViewProps = React.ComponentProps<typeof RNSafeAreaView> & {
  className?: string;
};
const SafeAreaViewImpl = RNSafeAreaView as unknown as React.ComponentType<Record<string, unknown>>;
export const SafeAreaView = (props: SafeAreaViewProps) =>
  useCssElement(SafeAreaViewImpl, props as Record<string, unknown>, { className: 'style' });
SafeAreaView.displayName = 'CSS(SafeAreaView)';
