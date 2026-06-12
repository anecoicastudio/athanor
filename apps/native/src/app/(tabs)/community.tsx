import { t } from '@kaira/i18n';
import { Text, View } from '@/tw';

export default function CommunityScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-background">
      <Text className="text-foreground">{t('tabs.community', 'it')}</Text>
    </View>
  );
}
