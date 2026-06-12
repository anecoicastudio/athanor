import { t } from '@kaira/i18n';
import { Text, View } from '@/tw';

export default function ProfiloScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-background">
      <Text className="text-foreground">{t('tabs.profilo', 'it')}</Text>
    </View>
  );
}
