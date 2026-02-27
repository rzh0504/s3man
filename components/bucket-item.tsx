import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { Badge } from '@/components/ui/badge';
import type { BucketInfo } from '@/lib/types';
import { formatDate } from '@/lib/constants';
import { FolderIcon, AlertTriangleIcon } from 'lucide-react-native';
import React from 'react';
import { View, Pressable } from 'react-native';

interface BucketItemProps {
  bucket: BucketInfo;
  onPress: () => void;
}

export const BucketItem = React.memo(function BucketItem({ bucket, onPress }: BucketItemProps) {
  return (
    <Pressable
      onPress={onPress}
      className="border-border active:bg-accent flex-row items-center gap-3 border-b px-6 py-4">
      <Icon as={FolderIcon} className="text-muted-foreground size-6" />
      <View className="flex-1 gap-1">
        <Text className="text-foreground text-base font-medium">{bucket.name}</Text>
        <Text className="text-muted-foreground text-xs">
          Created {formatDate(bucket.creationDate)}
        </Text>
      </View>
      {bucket.region && (
        <Badge variant="outline" className="ml-auto">
          <Text className="text-xs">{bucket.region}</Text>
        </Badge>
      )}
    </Pressable>
  );
});
