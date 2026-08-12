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

/** Join conditional NativeWind classes — falsy parts drop out, so call sites avoid
 *  empty-string ternaries (`cond ? 'x' : ''`) inside template literals. */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export type ViewProps = React.ComponentProps<typeof RNView> & { className?: string };
export const View = (props: ViewProps) => useCssElement(RNView, props, { className: 'style' });
View.displayName = 'CSS(View)';

// Default family (DESIGN §4: everything is Hanken). Precedence is stylesheet
// SOURCE ORDER in global.css — `.font-app` is defined before the font-weight
// remaps and `.font-dream`, so explicit font-* utilities on the call site win.
// Don't reorder those rules.
const withAppFont = <P extends { className?: string }>(props: P): P => ({
  ...props,
  className: props.className ? `font-app ${props.className}` : 'font-app',
});

export type TextProps = React.ComponentProps<typeof RNText> & { className?: string };
export const Text = (props: TextProps) =>
  useCssElement(RNText, withAppFont(props), { className: 'style' });
Text.displayName = 'CSS(Text)';

export type PressableProps = React.ComponentProps<typeof RNPressable> & { className?: string };
// Erased generic: Pressable/ScrollView function-style props explode TS union
// inference inside useCssElement (TS2590). Public prop types stay exact.
const PressableImpl = RNPressable as unknown as React.ComponentType<Record<string, unknown>>;
export const Pressable = (props: PressableProps) =>
  useCssElement(PressableImpl, props as Record<string, unknown>, { className: 'style' });
Pressable.displayName = 'CSS(Pressable)';

export type ScrollViewProps = React.ComponentProps<typeof RNScrollView> & {
  className?: string;
  contentContainerClassName?: string;
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
  useCssElement(RNTextInput, withAppFont(props), { className: 'style' });
TextInput.displayName = 'CSS(TextInput)';
