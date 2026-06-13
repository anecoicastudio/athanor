import { Stack } from 'expo-router';
import { colors } from '@kaira/config';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bluNotte } }}
    />
  );
}
