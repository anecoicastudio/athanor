import '../global.css';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { colors } from '@kaira/config';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bluNotte },
        }}
      >
        <Stack.Screen name="(tabs)" />
      </Stack>
    </>
  );
}
