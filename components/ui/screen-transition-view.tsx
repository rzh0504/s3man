import { useIsFocused } from '@react-navigation/native';
import * as React from 'react';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

type ScreenTransitionViewProps = React.ComponentProps<typeof Animated.View> & {
  disabled?: boolean;
  hiddenOpacity?: number;
  offset?: number;
  enterDuration?: number;
  exitDuration?: number;
};

export function ScreenTransitionView({
  children,
  style,
  disabled = false,
  hiddenOpacity = 0.84,
  offset = 10,
  enterDuration = 220,
  exitDuration = 140,
  ...props
}: ScreenTransitionViewProps) {
  const isFocused = useIsFocused();
  const prefersReducedMotion = useReducedMotion();
  const progress = useSharedValue(disabled || prefersReducedMotion ? 1 : 0);

  React.useEffect(() => {
    if (disabled || prefersReducedMotion) {
      progress.value = 1;
      return;
    }

    progress.value = withTiming(isFocused ? 1 : 0, {
      duration: isFocused ? enterDuration : exitDuration,
      easing: isFocused ? Easing.out(Easing.cubic) : Easing.out(Easing.quad),
      reduceMotion: ReduceMotion.System,
    });
  }, [disabled, enterDuration, exitDuration, isFocused, prefersReducedMotion, progress]);

  const animatedStyle = useAnimatedStyle(
    () => ({
      opacity:
        disabled || prefersReducedMotion
          ? 1
          : hiddenOpacity + (1 - hiddenOpacity) * progress.value,
      transform:
        disabled || prefersReducedMotion
          ? [{ translateY: 0 }]
          : [{ translateY: (1 - progress.value) * offset }],
    }),
    [disabled, hiddenOpacity, offset, prefersReducedMotion]
  );

  return (
    <Animated.View {...props} style={[style, animatedStyle]}>
      {children}
    </Animated.View>
  );
}
