import { Stack } from 'expo-router';
import { galleria } from '@athanor/config';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: galleria.background } }}
    />
  );
}
