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
  FileAudioIcon,
  FileSpreadsheetIcon,
} from 'lucide-react-native';
import React from 'react';
import { View, Pressable, Image } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';

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
    'c',
    'cpp',
    'toml',
    'lua',
    'rs',
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

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico'];

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

const ICON_SIZE = 24;
const THUMB_RADIUS = 6;

function ImageThumbnail({ url }: { url: string }) {
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState(false);

  if (error) {
    return (
      <View className="items-center justify-center" style={{ width: ICON_SIZE, height: ICON_SIZE }}>
        <Icon as={ImageIcon} className="size-5 text-emerald-600" />
      </View>
    );
  }

  return (
    <View
      className="items-center justify-center overflow-hidden"
      style={{ width: ICON_SIZE, height: ICON_SIZE, borderRadius: THUMB_RADIUS }}>
      {!loaded && (
        <Skeleton
          className="absolute"
          style={{ width: ICON_SIZE, height: ICON_SIZE, borderRadius: THUMB_RADIUS }}
        />
      )}
      <Image
        source={{ uri: url }}
        style={{ width: ICON_SIZE, height: ICON_SIZE, borderRadius: THUMB_RADIUS }}
        resizeMode="cover"
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
      />
    </View>
  );
}

function FileTypeIcon({ info }: { info: FileTypeInfo }) {
  return (
    <View className="items-center justify-center" style={{ width: ICON_SIZE, height: ICON_SIZE }}>
      <Icon as={info.icon} className={`${info.color} size-5`} />
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
        <View
          className="items-center justify-center"
          style={{ width: ICON_SIZE, height: ICON_SIZE }}>
          <Icon as={FolderIcon} className="size-5 text-blue-600" />
        </View>
        <Text className="text-foreground flex-1">{folderName}</Text>
        <Text className="text-muted-foreground w-20 text-right text-xs">-</Text>
      </Pressable>
    );
  }

  const fileTypeInfo = getFileTypeInfo(object.name);
  const showThumbnail = isImageExt(object.name) && thumbnailUrl;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      className="active:bg-accent flex-row items-center gap-3 px-4 py-3">
      {selectionMode && <Checkbox checked={isSelected} onCheckedChange={() => onToggle()} />}
      {showThumbnail ? <ImageThumbnail url={thumbnailUrl} /> : <FileTypeIcon info={fileTypeInfo} />}
      <Text className="text-foreground flex-1" numberOfLines={1}>
        {object.name}
      </Text>
      <Text className="text-muted-foreground w-20 text-right text-xs">
        {object.size != null ? formatBytes(object.size) : '-'}
      </Text>
    </Pressable>
  );
});
