import { Stack } from 'expo-router';
import { galleria } from '@athanor/config';

export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: galleria.background } }}
    />
  );
}
