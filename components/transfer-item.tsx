import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
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
  UploadIcon,
  DownloadIcon,
  FileArchiveIcon,
  FileIcon,
  ImageIcon,
  FileVideoIcon,
  FilmIcon,
} from 'lucide-react-native';
import React from 'react';
import { View, Image } from 'react-native';
import { getFileExtension } from '@/lib/constants';
import type { LucideIcon } from 'lucide-react-native';

function getTransferIcon(fileName: string): LucideIcon {
  const ext = getFileExtension(fileName);
  const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'];
  const videoExts = ['mp4', 'mov', 'avi', 'webm'];
  const archiveExts = ['zip', 'tar', 'gz', 'rar', '7z', 'fig'];

  if (imageExts.includes(ext)) return ImageIcon;
  if (videoExts.includes(ext)) return FilmIcon;
  if (archiveExts.includes(ext)) return FileArchiveIcon;
  return FileIcon;
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
  const TransferIcon = getTransferIcon(task.fileName);
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
      return `Completed • ${formatBytes(task.totalBytes)}`;
    }
    if (isFailed) {
      return task.error || 'Failed';
    }
    if (isPaused) {
      return `Stopped at ${formatBytes(task.transferredBytes)}`;
    }
    const remaining = task.totalBytes - task.transferredBytes;
    const estimatedSeconds =
      remaining > 0 ? Math.ceil(remaining / (task.transferredBytes / 10)) : 0;
    const timeStr =
      estimatedSeconds > 60
        ? `${Math.ceil(estimatedSeconds / 60)} mins remaining`
        : `${estimatedSeconds} secs remaining`;
    return `${formatBytes(task.transferredBytes)} of ${formatBytes(task.totalBytes)} • ${timeStr}`;
  }, [task, isCompleted, isFailed, isPaused]);

  return (
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
            <Icon as={TransferIcon} className="text-muted-foreground size-6" />
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
              Paused
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
                <Text>Pause</Text>
              </Button>
            )}
            {isPaused && (
              <Button
                variant="outline"
                size="sm"
                onPress={onResume}
                className="flex-row items-center gap-1.5">
                <Icon as={PlayIcon} className="text-foreground size-3.5" />
                <Text>Resume</Text>
              </Button>
            )}
            {isActive && (
              <Button
                variant="outline"
                size="sm"
                onPress={onCancel}
                className="flex-row items-center gap-1.5">
                <Icon as={XIcon} className="text-destructive size-3.5" />
                <Text className="text-destructive">Cancel</Text>
              </Button>
            )}
            {isPaused && (
              <Button
                variant="outline"
                size="sm"
                onPress={onRemove}
                className="flex-row items-center gap-1.5">
                <Icon as={Trash2Icon} className="text-destructive size-3.5" />
                <Text className="text-destructive">Remove</Text>
              </Button>
            )}
          </View>
        )}
      </CardContent>
    </Card>
  );
});
