import { Stack } from 'expo-router';
import { semantic } from '@auria/config';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: semantic.background } }}
    />
  );
}
