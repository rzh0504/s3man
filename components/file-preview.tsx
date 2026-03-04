import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { formatBytes } from '@/lib/constants';
import { isImageFile } from '@/lib/s3-service';
import type { S3Object } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { XIcon, DownloadIcon, ExternalLinkIcon, LinkIcon } from 'lucide-react-native';
import * as React from 'react';
import { View, Modal, Pressable, Image, ScrollView, Dimensions, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  runOnJS,
  Easing,
} from 'react-native-reanimated';

interface FilePreviewProps {
  visible: boolean;
  onClose: () => void;
  onDownload: () => void;
  onCopyLink?: () => void;
  object: S3Object | null;
  previewUrl: string | null;
  textContent: string | null;
  isLoading: boolean;
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export function FilePreview({
  visible,
  onClose,
  onDownload,
  onCopyLink,
  object,
  previewUrl,
  textContent,
  isLoading,
}: FilePreviewProps) {
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(SCREEN_HEIGHT);
  const backdropOpacity = useSharedValue(0);
  const [modalVisible, setModalVisible] = React.useState(false);

  React.useEffect(() => {
    if (visible) {
      setModalVisible(true);
      translateY.value = SCREEN_HEIGHT;
      backdropOpacity.value = 0;
      requestAnimationFrame(() => {
        translateY.value = withSpring(0, { damping: 22, stiffness: 220, mass: 0.8 });
        backdropOpacity.value = withTiming(1, { duration: 250 });
      });
    } else {
      translateY.value = withTiming(
        SCREEN_HEIGHT,
        { duration: 280, easing: Easing.bezier(0.4, 0, 1, 1) },
        (finished) => {
          if (finished) runOnJS(setModalVisible)(false);
        }
      );
      backdropOpacity.value = withTiming(0, { duration: 200 });
    }
  }, [visible]);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  if (!object) return null;

  const isImage = isImageFile(object.name);

  return (
    <Modal visible={modalVisible} animationType="none" transparent statusBarTranslucent>
      {/* Backdrop */}
      <Animated.View style={[{ flex: 1 }, backdropStyle]}>
        <Pressable className="flex-1" onPress={onClose}>
          {Platform.OS === 'ios' ? (
            <BlurView intensity={40} tint="dark" style={{ flex: 1 }} />
          ) : (
            <View className="flex-1 bg-black/40" />
          )}
        </Pressable>
      </Animated.View>

      {/* Sheet */}
      <Animated.View
        style={[
          {
            position: 'absolute',
            top: 56,
            left: 0,
            right: 0,
            bottom: 0,
          },
          sheetStyle,
        ]}>
        <View
          className="bg-background flex-1 overflow-hidden rounded-t-2xl shadow-2xl shadow-black/30"
          style={{ paddingBottom: insets.bottom }}>
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
            <View className="flex-row items-center gap-1">
              {onCopyLink && (
                <Pressable onPress={onCopyLink} className="rounded-md p-1">
                  <Icon as={LinkIcon} className="text-foreground size-5" />
                </Pressable>
              )}
              <Pressable onPress={onDownload} className="rounded-md p-1">
                <Icon as={DownloadIcon} className="text-foreground size-6" />
              </Pressable>
            </View>
          </View>

          {/* Content */}
          <View className="flex-1 items-center justify-center">
            {isLoading ? (
              isImage ? (
                <View className="items-center justify-center p-4">
                  <Skeleton
                    className="rounded-lg"
                    style={{ width: SCREEN_WIDTH - 32, height: SCREEN_WIDTH - 32 }}
                  />
                </View>
              ) : (
                <View className="w-full flex-1 p-4">
                  <Skeleton className="mb-3 h-5 w-2/3 rounded" />
                  <Skeleton className="mb-2 h-4 w-full rounded" />
                  <Skeleton className="mb-2 h-4 w-full rounded" />
                  <Skeleton className="mb-2 h-4 w-5/6 rounded" />
                  <Skeleton className="mb-2 h-4 w-full rounded" />
                  <Skeleton className="mb-2 h-4 w-3/4 rounded" />
                  <Skeleton className="mb-2 h-4 w-full rounded" />
                  <Skeleton className="h-4 w-1/2 rounded" />
                </View>
              )
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
      </Animated.View>
    </Modal>
  );
}
