import { FadeIn, FadeOut, ReduceMotion } from 'react-native-reanimated';

const ENTER_DURATION = 160;
const EXIT_DURATION = 110;

export function fadeIn(delay = 0) {
  const animation = FadeIn.duration(ENTER_DURATION);
  return (delay > 0 ? animation.delay(delay) : animation).reduceMotion(ReduceMotion.System);
}

export function fadeOut() {
  return FadeOut.duration(EXIT_DURATION).reduceMotion(ReduceMotion.System);
}
