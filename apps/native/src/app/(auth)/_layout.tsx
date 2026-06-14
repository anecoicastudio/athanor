import { Stack } from 'expo-router';
import { semantic } from '@athanor/config';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: semantic.background } }}
    />
  );
}
