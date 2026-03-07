import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { formatBytes } from '@/lib/constants';
import { isImageFile, isVideoFile, isCodeFile, isPdfFile } from '@/lib/s3-service';
import type { S3Object } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { XIcon, DownloadIcon, ExternalLinkIcon, LinkIcon, GlobeIcon } from 'lucide-react-native';
import * as React from 'react';
import { View, Modal, Pressable, Image, ScrollView, Dimensions, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as Linking from 'expo-linking';
import { t } from '@/lib/i18n';
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
const MAX_PREVIEW_WIDTH = SCREEN_WIDTH - 32;
const SHEET_HEIGHT_SMALL = 280;
const SHEET_HEIGHT_MEDIUM = Math.round(SCREEN_HEIGHT * 0.7);

// ── Video Player Sub-component ──────────────────────────────────────────

function VideoPreview({ url }: { url: string }) {
  const player = useVideoPlayer(url, (p) => {
    p.loop = false;
  });

  return (
    <View className="w-full items-center justify-center p-4">
      <VideoView
        player={player}
        style={{
          width: MAX_PREVIEW_WIDTH,
          height: MAX_PREVIEW_WIDTH * (9 / 16),
          borderRadius: 12,
        }}
        nativeControls
      />
    </View>
  );
}

// ── Dynamic Image Preview Sub-component ─────────────────────────────────

function ImagePreview({ url }: { url: string }) {
  const [size, setSize] = React.useState<{ w: number; h: number } | null>(null);

  React.useEffect(() => {
    Image.getSize(
      url,
      (w, h) => setSize({ w, h }),
      () => setSize({ w: MAX_PREVIEW_WIDTH, h: MAX_PREVIEW_WIDTH })
    );
  }, [url]);

  const displaySize = React.useMemo(() => {
    if (!size) return { width: MAX_PREVIEW_WIDTH, height: MAX_PREVIEW_WIDTH };
    const aspect = size.w / size.h;
    const maxH = SCREEN_HEIGHT * 0.6;
    let width = MAX_PREVIEW_WIDTH;
    let height = width / aspect;
    if (height > maxH) {
      height = maxH;
      width = height * aspect;
    }
    return { width, height };
  }, [size]);

  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName="flex-1 items-center justify-center p-4"
      maximumZoomScale={5}
      minimumZoomScale={1}>
      <Image
        source={{ uri: url }}
        style={{ width: displaySize.width, height: displaySize.height, borderRadius: 8 }}
        resizeMode="contain"
      />
    </ScrollView>
  );
}

// ── Main FilePreview ────────────────────────────────────────────────────

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

  const isImage = object ? isImageFile(object.name) : false;
  const isVideo = object ? isVideoFile(object.name) : false;
  const isCode = object ? isCodeFile(object.name) : false;
  const isPdf = object ? isPdfFile(object.name) : false;
  const hasPreviewContent = isImage || isVideo || isCode || isPdf || textContent !== null;

  const sheetHeight = React.useMemo(() => {
    if (isLoading) return SHEET_HEIGHT_MEDIUM;
    if (!hasPreviewContent) return SHEET_HEIGHT_SMALL + insets.bottom;
    if (isPdf) return SHEET_HEIGHT_SMALL + insets.bottom;
    return SHEET_HEIGHT_MEDIUM;
  }, [hasPreviewContent, isPdf, isLoading, insets.bottom]);

  const translateY = useSharedValue(SCREEN_HEIGHT);
  const backdropOpacity = useSharedValue(0);
  const [modalVisible, setModalVisible] = React.useState(false);

  React.useEffect(() => {
    if (visible) {
      setModalVisible(true);
      translateY.value = SCREEN_HEIGHT;
      backdropOpacity.value = 0;
      requestAnimationFrame(() => {
        translateY.value = withSpring(0, { damping: 25, stiffness: 300, mass: 0.7 });
        backdropOpacity.value = withTiming(1, { duration: 150 });
      });
    } else {
      translateY.value = withTiming(
        SCREEN_HEIGHT,
        { duration: 200, easing: Easing.bezier(0.4, 0, 1, 1) },
        (finished) => {
          if (finished) runOnJS(setModalVisible)(false);
        }
      );
      backdropOpacity.value = withTiming(0, { duration: 150 });
    }
  }, [visible]);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  if (!object) return null;

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
            left: 0,
            right: 0,
            bottom: 0,
            height: sheetHeight,
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
                    style={{ width: MAX_PREVIEW_WIDTH, height: MAX_PREVIEW_WIDTH * 0.75 }}
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
              <ImagePreview url={previewUrl} />
            ) : isVideo && previewUrl ? (
              <VideoPreview url={previewUrl} />
            ) : isPdf && previewUrl ? (
              <View className="items-center gap-3 p-8">
                <Icon as={ExternalLinkIcon} className="text-muted-foreground size-12" />
                <Text className="text-muted-foreground text-center text-sm">
                  {t('preview.pdfHint')}
                </Text>
                <Button
                  onPress={() => Linking.openURL(previewUrl)}
                  className="mt-2 flex-row items-center gap-2">
                  <Icon as={GlobeIcon} className="text-primary-foreground size-4" />
                  <Text className="text-primary-foreground">{t('preview.openInBrowser')}</Text>
                </Button>
                <Button
                  variant="outline"
                  onPress={onDownload}
                  className="flex-row items-center gap-2">
                  <Icon as={DownloadIcon} className="text-foreground size-4" />
                  <Text className="text-foreground">{t('preview.downloadFile')}</Text>
                </Button>
              </View>
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
                  {t('preview.notAvailable')}
                </Text>
                <Button onPress={onDownload} className="mt-2 flex-row items-center gap-2">
                  <Icon as={DownloadIcon} className="text-primary-foreground size-4" />
                  <Text className="text-primary-foreground">{t('preview.downloadFile')}</Text>
                </Button>
              </View>
            )}
          </View>
        </View>
      </Animated.View>
    </Modal>
  );
}
