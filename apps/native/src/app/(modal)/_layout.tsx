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
      <Stack.Screen name="user/[id]" options={{ presentation: 'modal' }} />
      <Stack.Screen name="post-compose" options={{ presentation: 'modal' }} />
      <Stack.Screen name="project-compose" options={{ presentation: 'modal' }} />
      <Stack.Screen name="favor" options={{ presentation: 'modal' }} />
      <Stack.Screen name="listing/[id]" options={{ presentation: 'modal' }} />
      <Stack.Screen name="post/[id]" options={{ presentation: 'modal' }} />
      <Stack.Screen name="stories" options={{ animation: 'fade' }} />
      <Stack.Screen name="match" options={{ animation: 'fade' }} />
      <Stack.Screen name="messages" options={{ presentation: 'modal' }} />
      <Stack.Screen name="connections" options={{ presentation: 'modal' }} />
      <Stack.Screen name="chat" options={{ presentation: 'modal' }} />
      <Stack.Screen name="live" />
      <Stack.Screen name="event/[id]/index" options={{ presentation: 'modal' }} />
      <Stack.Screen name="event/[id]/checkin" options={{ presentation: 'modal' }} />
      <Stack.Screen name="ticket/[id]" options={{ presentation: 'modal' }} />
      <Stack.Screen name="event-create" options={{ presentation: 'modal' }} />
      <Stack.Screen name="annual" options={{ presentation: 'modal' }} />
      <Stack.Screen name="candidacy" options={{ presentation: 'modal' }} />
      <Stack.Screen name="candidacy/[id]" options={{ presentation: 'modal' }} />
      <Stack.Screen name="aura" options={{ presentation: 'modal' }} />
      <Stack.Screen name="aura/ledger" options={{ presentation: 'modal' }} />
      <Stack.Screen name="star" options={{ presentation: 'modal' }} />
      <Stack.Screen name="recap" options={{ presentation: 'modal' }} />
      <Stack.Screen name="level" options={{ animation: 'fade' }} />
      <Stack.Screen name="candidacy-success" options={{ animation: 'fade' }} />
      <Stack.Screen name="contribution-thanks" options={{ animation: 'fade' }} />
      <Stack.Screen name="circle" options={{ presentation: 'modal' }} />
      <Stack.Screen name="search" options={{ presentation: 'modal' }} />
      <Stack.Screen name="search-filters" options={{ presentation: 'modal' }} />
      <Stack.Screen name="blocked" options={{ presentation: 'modal' }} />
      <Stack.Screen name="report" options={{ presentation: 'modal' }} />
      {/* M9 notification center + preferences */}
      <Stack.Screen name="notifications" options={{ presentation: 'modal' }} />
      <Stack.Screen name="notif-prefs" options={{ presentation: 'modal' }} />
      {/* M9 trust & safety */}
      <Stack.Screen name="trust" options={{ presentation: 'modal' }} />
      {/* M9 GDPR export + erasure */}
      <Stack.Screen name="data-export" options={{ presentation: 'modal' }} />
      <Stack.Screen name="delete-account" options={{ presentation: 'modal' }} />
      {/* M9 identity verify */}
      <Stack.Screen name="verify" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
