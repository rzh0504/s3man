import { useIsFocused } from 'expo-router/react-navigation';
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
  hiddenOpacity = 0,
  enterDuration = 160,
  exitDuration = 110,
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
      easing: Easing.out(Easing.quad),
      reduceMotion: ReduceMotion.System,
    });
  }, [disabled, enterDuration, exitDuration, isFocused, prefersReducedMotion, progress]);

  const animatedStyle = useAnimatedStyle(
    () => ({
      opacity:
        disabled || prefersReducedMotion
          ? 1
          : hiddenOpacity + (1 - hiddenOpacity) * progress.value,
    }),
    [disabled, hiddenOpacity, prefersReducedMotion]
  );

  return (
    <Animated.View {...props} style={[style, animatedStyle]}>
      {children}
    </Animated.View>
  );
}
