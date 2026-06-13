import { t } from '@auria/i18n';
import { Text, View } from '@/tw';

export default function HomeScreen() {
  return (
    <View className="flex-1 items-center justify-center gap-2 bg-background">
      <Text className="text-3xl font-semibold tracking-widest text-foreground">
        {t('app.name', 'it').toUpperCase()}
      </Text>
      <Text className="text-muted-foreground">{t('app.tagline', 'it')}</Text>
    </View>
  );
}
