import { t } from '@auria/i18n';
import { Text, View } from '@/tw';

export default function MomentsScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-background">
      <Text className="text-foreground">{t('tabs.moments', 'it')}</Text>
    </View>
  );
}
