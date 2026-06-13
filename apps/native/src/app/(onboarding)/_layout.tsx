import { Stack } from 'expo-router';
import { colors } from '@kaira/config';

export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.notte } }}
    />
  );
}
