import { Text } from '@/components/ui/text';
import React from 'react';
import { Pressable, ScrollView } from 'react-native';

interface BreadcrumbProps {
  crumbs: { label: string; prefix: string }[];
  onPress: (prefix: string) => void;
}

export const Breadcrumb = React.memo(function Breadcrumb({ crumbs, onPress }: BreadcrumbProps) {
  return (
    <ScrollView
      style={{ minHeight: 20 }}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="flex-row items-center gap-1">
      {crumbs.map((crumb, index) => (
        <React.Fragment key={crumb.prefix + index}>
          {index > 0 && <Text className="text-muted-foreground text-sm leading-5">/</Text>}
          <Pressable onPress={() => onPress(crumb.prefix)}>
            <Text
              className={`text-sm leading-5 ${
                index === crumbs.length - 1
                  ? 'text-foreground font-medium'
                  : 'text-muted-foreground'
              }`}>
              {crumb.label}
            </Text>
          </Pressable>
        </React.Fragment>
      ))}
    </ScrollView>
  );
});
