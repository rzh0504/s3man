import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { NativeOnlyAnimatedView } from '@/components/ui/native-only-animated-view';
import { Text } from '@/components/ui/text';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import type { TransferTask } from '@/lib/types';
import { formatBytes } from '@/lib/constants';
import {
  PauseIcon,
  PlayIcon,
  XIcon,
  Trash2Icon,
  CheckCircleIcon,
  FileIcon,
  ImageIcon,
  FileVideoIcon,
  FileTextIcon,
  FileArchiveIcon,
  FileCodeIcon,
  FileAudioIcon,
  FileSpreadsheetIcon,
} from 'lucide-react-native';
import React from 'react';
import { View, Image } from 'react-native';
import { getFileExtension } from '@/lib/constants';
import { t } from '@/lib/i18n';
import type { LucideIcon } from 'lucide-react-native';
import { FadeInDown, FadeOutUp, ReduceMotion } from 'react-native-reanimated';

type FileTypeInfo = { icon: LucideIcon; color: string };

function getFileTypeInfo(name: string): FileTypeInfo {
  const ext = getFileExtension(name);
  const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'];
  const videoExts = ['mp4', 'mov', 'avi', 'webm', 'mkv'];
  const audioExts = ['mp3', 'wav', 'ogg', 'aac', 'm4a', 'flac', 'wma'];
  const archiveExts = ['zip', 'tar', 'gz', 'rar', '7z'];
  const codeExts = [
    'json',
    'xml',
    'html',
    'css',
    'js',
    'ts',
    'tsx',
    'jsx',
    'py',
    'yaml',
    'yml',
    'c',
    'cpp',
    'toml',
    'lua',
    'rs',
    'go',
    'swift',
    'kt',
    'dart',
    'sh',
    'sql',
    'rb',
    'java',
  ];
  const spreadsheetExts = ['xls', 'xlsx', 'csv'];
  const textExts = ['txt', 'md', 'log', 'pdf', 'doc', 'docx'];

  if (imageExts.includes(ext)) return { icon: ImageIcon, color: 'text-emerald-600' };
  if (videoExts.includes(ext)) return { icon: FileVideoIcon, color: 'text-purple-600' };
  if (audioExts.includes(ext)) return { icon: FileAudioIcon, color: 'text-pink-600' };
  if (archiveExts.includes(ext)) return { icon: FileArchiveIcon, color: 'text-amber-600' };
  if (codeExts.includes(ext)) return { icon: FileCodeIcon, color: 'text-blue-600' };
  if (spreadsheetExts.includes(ext)) return { icon: FileSpreadsheetIcon, color: 'text-green-600' };
  if (textExts.includes(ext)) return { icon: FileTextIcon, color: 'text-sky-600' };
  return { icon: FileIcon, color: 'text-muted-foreground' };
}

function getProgressColor(status: TransferTask['status']): string {
  switch (status) {
    case 'completed':
      return 'bg-green-500';
    case 'failed':
      return 'bg-destructive';
    case 'paused':
      return 'bg-yellow-500';
    default:
      return 'bg-primary';
  }
}

interface TransferItemProps {
  task: TransferTask;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onRemove: () => void;
}

export const TransferItem = React.memo(function TransferItem({
  task,
  onPause,
  onResume,
  onCancel,
  onRemove,
}: TransferItemProps) {
  const fileTypeInfo = getFileTypeInfo(task.fileName);
  const isImage = (() => {
    const ext = getFileExtension(task.fileName);
    return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext);
  })();
  const hasThumbnail = isImage && !!task.localPath;
  const isActive = task.status === 'active';
  const isPaused = task.status === 'paused';
  const isCompleted = task.status === 'completed';
  const isFailed = task.status === 'failed';

  const progressText = React.useMemo(() => {
    if (isCompleted) {
      return t('transfers.completedStatus', { size: formatBytes(task.totalBytes) });
    }
    if (isFailed) {
      return task.error || t('transfers.failed');
    }
    if (isPaused) {
      return t('transfers.stoppedAt', { size: formatBytes(task.transferredBytes) });
    }
    const remaining = task.totalBytes - task.transferredBytes;
    const estimatedSeconds =
      remaining > 0 ? Math.ceil(remaining / (task.transferredBytes / 10)) : 0;
    const timeStr =
      estimatedSeconds > 60
        ? t('transfers.minsRemaining', { mins: Math.ceil(estimatedSeconds / 60) })
        : t('transfers.secsRemaining', { secs: estimatedSeconds });
    return t('transfers.progressText', {
      transferred: formatBytes(task.transferredBytes),
      total: formatBytes(task.totalBytes),
      time: timeStr,
    });
  }, [task, isCompleted, isFailed, isPaused]);

  return (
    <NativeOnlyAnimatedView
      entering={FadeInDown.duration(180).reduceMotion(ReduceMotion.System)}
      exiting={FadeOutUp.duration(140).reduceMotion(ReduceMotion.System)}>
      <Card className="gap-0 py-4">
        <CardContent className="gap-3 px-4">
          {/* Header row */}
          <View className="flex-row items-center gap-3">
            {hasThumbnail ? (
              <Image
                source={{ uri: task.localPath }}
                className="size-10 rounded-md"
                resizeMode="cover"
              />
            ) : (
              <Icon as={fileTypeInfo.icon} className={`${fileTypeInfo.color} size-6`} />
            )}
            <View className="flex-1">
              <Text className="text-foreground text-sm font-medium" numberOfLines={1}>
                {task.fileName}
              </Text>
              <Text className="text-muted-foreground text-xs">{progressText}</Text>
            </View>
            {isCompleted && (
              <View className="flex-row items-center gap-1">
                <Icon as={CheckCircleIcon} className="size-4 text-green-500" />
              </View>
            )}
            {isPaused && (
              <Text className="rounded bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300">
                {t('transfers.paused')}
              </Text>
            )}
            {!isCompleted && !isFailed && (
              <Text className="text-foreground text-sm font-semibold">{task.progress}%</Text>
            )}
          </View>

          {/* Progress bar */}
          {!isCompleted && !isFailed && (
            <Progress
              value={task.progress}
              className="h-1.5"
              indicatorClassName={getProgressColor(task.status)}
            />
          )}

          {/* Action buttons */}
          {(isActive || isPaused) && (
            <View className="flex-row items-center justify-end gap-2">
              {isActive && (
                <Button
                  variant="outline"
                  size="sm"
                  onPress={onPause}
                  className="flex-row items-center gap-1.5">
                  <Icon as={PauseIcon} className="text-foreground size-3.5" />
                  <Text>{t('transfers.pause')}</Text>
                </Button>
              )}
              {isPaused && (
                <Button
                  variant="outline"
                  size="sm"
                  onPress={onResume}
                  className="flex-row items-center gap-1.5">
                  <Icon as={PlayIcon} className="text-foreground size-3.5" />
                  <Text>{t('transfers.resume')}</Text>
                </Button>
              )}
              {isActive && (
                <Button
                  variant="outline"
                  size="sm"
                  onPress={onCancel}
                  className="flex-row items-center gap-1.5">
                  <Icon as={XIcon} className="text-destructive size-3.5" />
                  <Text className="text-destructive">{t('cancel')}</Text>
                </Button>
              )}
              {isPaused && (
                <Button
                  variant="outline"
                  size="sm"
                  onPress={onRemove}
                  className="flex-row items-center gap-1.5">
                  <Icon as={Trash2Icon} className="text-destructive size-3.5" />
                  <Text className="text-destructive">{t('transfers.remove')}</Text>
                </Button>
              )}
            </View>
          )}
        </CardContent>
      </Card>
    </NativeOnlyAnimatedView>
  );
});
