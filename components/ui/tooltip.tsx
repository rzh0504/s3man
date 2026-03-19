import { cn } from '@/lib/utils';
import * as TooltipPrimitive from '@rn-primitives/tooltip';
import * as React from 'react';
import { Platform } from 'react-native';

const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;
const TooltipPortal = TooltipPrimitive.Portal;

function TooltipOverlay({
  className,
  ...props
}: TooltipPrimitive.OverlayProps & React.RefAttributes<TooltipPrimitive.OverlayRef>) {
  return (
    <TooltipPrimitive.Overlay
      className={cn(
        'absolute inset-0 z-50',
        Platform.select({
          web: 'fixed cursor-default',
        }),
        className
      )}
      {...props}
    />
  );
}

function TooltipContent({
  className,
  portalHost,
  sideOffset = 8,
  ...props
}: TooltipPrimitive.ContentProps &
  React.RefAttributes<TooltipPrimitive.ContentRef> & {
    portalHost?: string;
  }) {
  return (
    <TooltipPortal hostName={portalHost}>
      <TooltipOverlay />
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          'bg-card border-border z-50 max-w-72 rounded-md border px-3 py-2 shadow-lg shadow-black/10',
          Platform.select({
            web: 'animate-in fade-in-0 zoom-in-95 duration-150',
          }),
          className
        )}
        {...props}
      />
    </TooltipPortal>
  );
}

export { Tooltip, TooltipContent, TooltipOverlay, TooltipPortal, TooltipTrigger };
