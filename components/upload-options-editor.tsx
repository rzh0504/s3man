import { Input } from '@/components/ui/input';
import { NativeOnlyAnimatedView } from '@/components/ui/native-only-animated-view';
import { Text } from '@/components/ui/text';
import { fadeIn, fadeOut } from '@/components/ui/fade-motion';
import { InfoTooltip } from '@/components/info-tooltip';
import { cn } from '@/lib/utils';
import { formatBytes } from '@/lib/constants';
import { useT } from '@/lib/i18n';
import {
  estimateCompressedFileSize,
  getUploadFileNameParts,
  isCompressibleImageFile,
  type UploadFileLike,
  type UploadImageCompression,
} from '@/lib/upload-preprocess';
import * as React from 'react';
import { View, Pressable, type LayoutChangeEvent } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

export interface UploadDraftFile extends UploadFileLike {
  id: string;
  originalName: string;
}

interface UploadOptionsEditorProps {
  files: UploadDraftFile[];
  imageCompression: UploadImageCompression;
  onFileNameChange: (id: string, name: string) => void;
  onImageCompressionChange: (value: UploadImageCompression) => void;
  validationError?: string | null;
}

const IMAGE_COMPRESSION_OPTIONS: Array<{
  value: UploadImageCompression;
  labelKey:
    | 'uploadConfig.keepOriginal'
    | 'uploadConfig.qualityHigh'
    | 'uploadConfig.qualityMedium'
    | 'uploadConfig.qualityLow';
}> = [
  { value: 'original', labelKey: 'uploadConfig.keepOriginal' },
  { value: 'high', labelKey: 'uploadConfig.qualityHigh' },
  { value: 'medium', labelKey: 'uploadConfig.qualityMedium' },
  { value: 'low', labelKey: 'uploadConfig.qualityLow' },
];

const TAB_TIMING_CONFIG = { duration: 180, easing: Easing.out(Easing.quad) };
const TAB_CONTAINER_PADDING = 3;
const TAB_GAP = 4;

function AnimatedCompressionTabs({
  value,
  onChange,
}: {
  value: UploadImageCompression;
  onChange: (value: UploadImageCompression) => void;
}) {
  const t = useT();
  const activeTabIndex = React.useMemo(
    () => Math.max(0, IMAGE_COMPRESSION_OPTIONS.findIndex((option) => option.value === value)),
    [value]
  );
  const [tabContainerWidth, setTabContainerWidth] = React.useState(0);
  const indicatorOffset = useSharedValue(0);
  const tabWidth = React.useMemo(() => {
    const innerWidth =
      tabContainerWidth - TAB_CONTAINER_PADDING * 2 - TAB_GAP * (IMAGE_COMPRESSION_OPTIONS.length - 1);
    return innerWidth > 0 ? innerWidth / IMAGE_COMPRESSION_OPTIONS.length : 0;
  }, [tabContainerWidth]);

  React.useEffect(() => {
    if (tabWidth <= 0) return;
    indicatorOffset.value = withTiming(activeTabIndex * (tabWidth + TAB_GAP), TAB_TIMING_CONFIG);
  }, [activeTabIndex, indicatorOffset, tabWidth]);

  const handleLayout = React.useCallback((event: LayoutChangeEvent) => {
    setTabContainerWidth(event.nativeEvent.layout.width);
  }, []);

  const indicatorStyle = useAnimatedStyle(() => ({
    opacity: tabWidth > 0 ? 1 : 0,
    width: tabWidth,
    transform: [{ translateX: indicatorOffset.value }],
  }));

  return (
    <View
      onLayout={handleLayout}
      className="bg-muted relative rounded-lg"
      style={{ padding: TAB_CONTAINER_PADDING }}>
      <Animated.View
        pointerEvents="none"
        style={[
          indicatorStyle,
          {
            position: 'absolute',
            left: TAB_CONTAINER_PADDING,
            top: TAB_CONTAINER_PADDING,
            bottom: TAB_CONTAINER_PADDING,
          },
        ]}
        className="bg-background dark:border-foreground/10 dark:bg-input/30 rounded-md border border-transparent shadow-sm shadow-black/5"
      />
      <View className="flex-row" style={{ gap: TAB_GAP }}>
        {IMAGE_COMPRESSION_OPTIONS.map((option) => {
          const isActive = option.value === value;
          return (
            <View key={option.value} className="flex-1">
              <Pressable
                onPress={() => onChange(option.value)}
                className="items-center justify-center rounded-md py-1.5">
                <Text
                  className={cn(
                    'text-sm font-medium',
                    isActive ? 'text-foreground' : 'text-muted-foreground'
                  )}
                  numberOfLines={1}>
                  {t(option.labelKey)}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const UploadFileNameField = React.memo(function UploadFileNameField({
  file,
  onFileNameChange,
  imageCompression,
}: {
  file: UploadDraftFile;
  onFileNameChange: (id: string, name: string) => void;
  imageCompression: UploadImageCompression;
}) {
  const t = useT();
  const initialParts = React.useMemo(() => getUploadFileNameParts(file.name), [file.name]);
  const [draftBaseName, setDraftBaseName] = React.useState(initialParts.baseName);

  React.useEffect(() => {
    setDraftBaseName(initialParts.baseName);
  }, [file.id, initialParts.baseName]);

  const extensionSuffix = initialParts.extension ? `.${initialParts.extension}` : '';
  const estimatedSize = React.useMemo(
    () => estimateCompressedFileSize(file, imageCompression),
    [file, imageCompression]
  );
  const sizeLabel =
    estimatedSize == null
      ? null
      : imageCompression !== 'original' && isCompressibleImageFile(file)
        ? `~${formatBytes(estimatedSize)}`
        : formatBytes(estimatedSize);

  return (
    <View className="gap-2">
      <View className="flex-row items-center justify-between gap-3">
        <Text className="text-foreground text-sm font-medium">{t('uploadConfig.fileName')}</Text>
        {sizeLabel ? (
          <View className="min-w-20 items-end">
            <NativeOnlyAnimatedView key={sizeLabel} entering={fadeIn(20)} exiting={fadeOut()}>
              <Text className="text-muted-foreground text-xs">{sizeLabel}</Text>
            </NativeOnlyAnimatedView>
          </View>
        ) : null}
      </View>
      <View className="flex-row items-center gap-2">
        <Input
          value={draftBaseName}
          onChangeText={(text) => {
            setDraftBaseName(text);
            onFileNameChange(file.id, `${text}${extensionSuffix}`);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={getUploadFileNameParts(file.originalName).baseName}
          className="flex-1"
        />
        {extensionSuffix ? (
          <View className="border-input bg-muted/40 min-w-16 items-center rounded-md border px-3 py-2">
            <Text className="text-foreground text-sm font-medium">{extensionSuffix}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
});

export function UploadOptionsEditor({
  files,
  imageCompression,
  onFileNameChange,
  onImageCompressionChange,
  validationError,
}: UploadOptionsEditorProps) {
  const t = useT();

  const compressibleImageCount = React.useMemo(
    () => files.filter((file) => isCompressibleImageFile(file)).length,
    [files]
  );

  return (
    <View className="gap-4">
      {compressibleImageCount > 0 && (
        <View className="gap-2">
          <View className="flex-row items-center gap-2">
            <Text className="text-foreground font-medium">{t('uploadConfig.imageCompression')}</Text>
            <InfoTooltip
              text={t('uploadConfig.imageCompressionDesc', { count: compressibleImageCount })}
            />
          </View>
          <AnimatedCompressionTabs value={imageCompression} onChange={onImageCompressionChange} />
        </View>
      )}

      <View className="gap-3">
        {files.map((file) => (
          <UploadFileNameField
            key={file.id}
            file={file}
            imageCompression={imageCompression}
            onFileNameChange={onFileNameChange}
          />
        ))}
      </View>

      {validationError ? (
        <View className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
          <Text className="text-sm text-red-600">{validationError}</Text>
        </View>
      ) : null}
    </View>
  );
}
