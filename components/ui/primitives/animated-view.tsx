import Animated from 'react-native-reanimated';
import { cssInterop } from 'react-native-css-interop';

export const AnimatedView = Animated.View;

cssInterop(AnimatedView, { className: 'style' });
