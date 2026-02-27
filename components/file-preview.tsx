import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { formatBytes } from '@/lib/constants';
import { isImageFile } from '@/lib/s3-service';
import type { S3Object } from '@/lib/types';
import { XIcon, DownloadIcon, ExternalLinkIcon } from 'lucide-react-native';
import * as React from 'react';
import {
  View,
  Modal,
  Pressable,
  Image,
  ScrollView,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface FilePreviewProps {
  visible: boolean;
  onClose: () => void;
  onDownload: () => void;
  object: S3Object | null;
  previewUrl: string | null;
  textContent: string | null;
  isLoading: boolean;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export function FilePreview({
  visible,
  onClose,
  onDownload,
  object,
  previewUrl,
  textContent,
  isLoading,
}: FilePreviewProps) {
  const insets = useSafeAreaInsets();

  if (!object) return null;

  const isImage = isImageFile(object.name);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View className="bg-background flex-1" style={{ paddingTop: insets.top }}>
        {/* Header */}
        <View className="border-border flex-row items-center justify-between border-b px-4 py-3">
          <Pressable onPress={onClose} className="rounded-md p-1">
            <Icon as={XIcon} className="text-foreground size-6" />
          </Pressable>
          <View className="mx-4 flex-1 items-center">
            <Text className="text-foreground text-sm font-semibold" numberOfLines={1}>
              {object.name}
            </Text>
            {object.size != null && (
              <Text className="text-muted-foreground text-xs">{formatBytes(object.size)}</Text>
            )}
          </View>
          <Pressable onPress={onDownload} className="rounded-md p-1">
            <Icon as={DownloadIcon} className="text-foreground size-6" />
          </Pressable>
        </View>

        {/* Content */}
        <View className="flex-1 items-center justify-center">
          {isLoading ? (
            <View className="items-center gap-3">
              <ActivityIndicator size="large" />
              <Text className="text-muted-foreground text-sm">Loading preview...</Text>
            </View>
          ) : isImage && previewUrl ? (
            <ScrollView
              className="flex-1"
              contentContainerClassName="flex-1 items-center justify-center p-4"
              maximumZoomScale={5}
              minimumZoomScale={1}>
              <Image
                source={{ uri: previewUrl }}
                style={{ width: SCREEN_WIDTH - 32, height: SCREEN_WIDTH - 32 }}
                resizeMode="contain"
              />
            </ScrollView>
          ) : textContent !== null ? (
            <ScrollView className="w-full flex-1" contentContainerClassName="p-4">
              <View className="bg-muted rounded-lg p-4">
                <Text className="text-foreground font-mono text-xs leading-5">{textContent}</Text>
              </View>
            </ScrollView>
          ) : (
            <View className="items-center gap-3 p-8">
              <Icon as={ExternalLinkIcon} className="text-muted-foreground size-12" />
              <Text className="text-muted-foreground text-center text-sm">
                Preview not available for this file type.
              </Text>
              <Button onPress={onDownload} className="mt-2 flex-row items-center gap-2">
                <Icon as={DownloadIcon} className="text-primary-foreground size-4" />
                <Text className="text-primary-foreground">Download File</Text>
              </Button>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}
