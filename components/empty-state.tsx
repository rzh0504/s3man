import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import type { LucideIcon } from 'lucide-react-native';
import React from 'react';
import { View } from 'react-native';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
}

export function EmptyState({ icon, title, description }: EmptyStateProps) {
  return (
    <View className="flex-1 items-center justify-center px-8 py-20">
      <Icon as={icon} className="text-muted-foreground mb-4 size-12" />
      <Text className="text-foreground text-lg font-semibold">{title}</Text>
      <Text className="text-muted-foreground mt-1 text-center text-sm">{description}</Text>
    </View>
  );
}
