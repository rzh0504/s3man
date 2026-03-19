import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { InfoIcon } from 'lucide-react-native';
import * as React from 'react';

export function InfoTooltip({
  text,
  className,
  iconClassName,
}: {
  text?: string;
  className?: string;
  iconClassName?: string;
}) {
  const t = useT();

  if (!text) return null;

  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger
        hitSlop={8}
        className="rounded-full p-0.5"
        accessibilityRole="button"
        accessibilityLabel={t('moreInfo')}>
        <Icon as={InfoIcon} className={cn('text-muted-foreground size-4', iconClassName)} />
      </TooltipTrigger>
      <TooltipContent className={className}>
        <Text className="text-foreground text-xs leading-5">{text}</Text>
      </TooltipContent>
    </Tooltip>
  );
}
