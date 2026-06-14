import { Stack } from 'expo-router';
import { semantic } from '@athanor/config';

export default function ModalLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: semantic.background },
      }}
    >
      <Stack.Screen name="settings" />
      <Stack.Screen name="grid" />
      <Stack.Screen name="dream-editor" options={{ presentation: 'modal' }} />
      <Stack.Screen name="milestone" options={{ presentation: 'modal' }} />
      <Stack.Screen name="help" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
