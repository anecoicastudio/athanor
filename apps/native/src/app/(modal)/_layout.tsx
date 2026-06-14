import { Stack } from 'expo-router';
import { semantic } from '@auria/config';

export default function ModalLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: semantic.background },
      }}
    >
      <Stack.Screen name="settings" />
    </Stack>
  );
}
