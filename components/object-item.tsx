import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import type { S3Object } from '@/lib/types';
import { formatBytes, getFileExtension } from '@/lib/constants';
import {
  FolderIcon,
  FileIcon,
  ImageIcon,
  FileVideoIcon,
  FileTextIcon,
  FileArchiveIcon,
  FileCodeIcon,
} from 'lucide-react-native';
import React from 'react';
import { View, Pressable, Image } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';

function getFileIcon(name: string): LucideIcon {
  const ext = getFileExtension(name);
  const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'];
  const videoExts = ['mp4', 'mov', 'avi', 'webm', 'mkv'];
  const archiveExts = ['zip', 'tar', 'gz', 'rar', '7z'];
  const codeExts = ['json', 'xml', 'html', 'css', 'js', 'ts', 'tsx', 'jsx'];
  const textExts = ['txt', 'md', 'csv', 'log', 'pdf', 'doc', 'docx'];

  if (imageExts.includes(ext)) return ImageIcon;
  if (videoExts.includes(ext)) return FileVideoIcon;
  if (archiveExts.includes(ext)) return FileArchiveIcon;
  if (codeExts.includes(ext)) return FileCodeIcon;
  if (textExts.includes(ext)) return FileTextIcon;
  return FileIcon;
}

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'];

function isImageExt(name: string): boolean {
  return IMAGE_EXTS.includes(getFileExtension(name));
}

interface ObjectItemProps {
  object: S3Object;
  isSelected: boolean;
  selectionMode: boolean;
  thumbnailUrl?: string | null;
  onPress: () => void;
  onToggle: () => void;
  onLongPress?: () => void;
}

function ImageThumbnail({ url }: { url: string }) {
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState(false);

  if (error) {
    return <Icon as={ImageIcon} className="text-muted-foreground size-8" />;
  }

  return (
    <View className="size-8 items-center justify-center overflow-hidden rounded">
      {!loaded && <Skeleton className="absolute size-8 rounded" />}
      <Image
        source={{ uri: url }}
        className="size-8 rounded"
        resizeMode="cover"
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
      />
    </View>
  );
}

export const ObjectItem = React.memo(function ObjectItem({
  object,
  isSelected,
  selectionMode,
  thumbnailUrl,
  onPress,
  onToggle,
  onLongPress,
}: ObjectItemProps) {
  if (object.isFolder) {
    // Strip trailing slash from folder display name
    const folderName = object.name.replace(/\/$/, '');
    return (
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        className="active:bg-accent flex-row items-center gap-3 px-4 py-3">
        {selectionMode && <Checkbox checked={isSelected} onCheckedChange={() => onToggle()} />}
        <Icon as={FolderIcon} className="text-muted-foreground size-5" />
        <Text className="text-foreground flex-1">{folderName}</Text>
        <Text className="text-muted-foreground w-20 text-right text-xs">-</Text>
      </Pressable>
    );
  }

  const FileIconComponent = getFileIcon(object.name);
  const showThumbnail = isImageExt(object.name) && thumbnailUrl;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      className="active:bg-accent flex-row items-center gap-3 px-4 py-3">
      {selectionMode && <Checkbox checked={isSelected} onCheckedChange={() => onToggle()} />}
      {showThumbnail ? (
        <ImageThumbnail url={thumbnailUrl} />
      ) : (
        <Icon as={FileIconComponent} className="text-muted-foreground size-5" />
      )}
      <Text className="text-foreground flex-1" numberOfLines={1}>
        {object.name}
      </Text>
      <Text className="text-muted-foreground w-20 text-right text-xs">
        {object.size != null ? formatBytes(object.size) : '-'}
      </Text>
    </Pressable>
  );
});
