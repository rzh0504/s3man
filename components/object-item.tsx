import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { Checkbox } from '@/components/ui/checkbox';
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
import { View, Pressable } from 'react-native';
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

interface ObjectItemProps {
  object: S3Object;
  isSelected: boolean;
  onPress: () => void;
  onToggle: () => void;
}

export const ObjectItem = React.memo(function ObjectItem({
  object,
  isSelected,
  onPress,
  onToggle,
}: ObjectItemProps) {
  if (object.isFolder) {
    return (
      <Pressable
        onPress={onPress}
        className="active:bg-accent flex-row items-center gap-3 px-4 py-3">
        <View className="w-6" />
        <Icon as={FolderIcon} className="text-muted-foreground size-5" />
        <Text className="text-foreground flex-1">{object.name}</Text>
        <Text className="text-muted-foreground w-20 text-right text-xs">-</Text>
      </Pressable>
    );
  }

  const FileIconComponent = getFileIcon(object.name);

  return (
    <Pressable onPress={onPress} className="active:bg-accent flex-row items-center gap-3 px-4 py-3">
      <Checkbox checked={isSelected} onCheckedChange={() => onToggle()} />
      <Icon as={FileIconComponent} className="text-muted-foreground size-5" />
      <Text className="text-foreground flex-1" numberOfLines={1}>
        {object.name}
      </Text>
      <Text className="text-muted-foreground w-20 text-right text-xs">
        {object.size != null ? formatBytes(object.size) : '-'}
      </Text>
    </Pressable>
  );
});
