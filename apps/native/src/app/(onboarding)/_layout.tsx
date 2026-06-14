import { Stack } from 'expo-router';
import { semantic } from '@athanor/config';

export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: semantic.background } }}
    />
  );
}
