import type { Theme } from '@react-navigation/native';

const NAV_FONTS = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  bold: 'Inter_600SemiBold',
  heavy: 'Inter_700Bold',
} as const;

export const NAV_THEME = {
  light: {
    background: 'hsl(0 0% 100%)', // background
    border: 'hsl(240 5.9% 90%)', // border
    card: 'hsl(0 0% 100%)', // card
    notification: 'hsl(0 84.2% 60.2%)', // destructive
    primary: 'hsl(240 5.9% 10%)', // primary
    text: 'hsl(240 10% 3.9%)', // foreground
  },
  dark: {
    background: 'hsl(240 10% 3.9%)', // background
    border: 'hsl(240 3.7% 15.9%)', // border
    card: 'hsl(240 10% 3.9%)', // card
    notification: 'hsl(0 72% 51%)', // destructive
    primary: 'hsl(0 0% 98%)', // primary
    text: 'hsl(0 0% 98%)', // foreground
  },
};

export const LIGHT_THEME: Theme = {
  dark: false,
  fonts: {
    regular: {
      fontFamily: NAV_FONTS.regular,
      fontWeight: '400',
    },
    medium: {
      fontFamily: NAV_FONTS.medium,
      fontWeight: '500',
    },
    bold: {
      fontFamily: NAV_FONTS.bold,
      fontWeight: '600',
    },
    heavy: {
      fontFamily: NAV_FONTS.heavy,
      fontWeight: '700',
    },
  },
  colors: NAV_THEME.light,
};
export const DARK_THEME: Theme = {
  dark: true,
  fonts: {
    regular: {
      fontFamily: NAV_FONTS.regular,
      fontWeight: '400',
    },
    medium: {
      fontFamily: NAV_FONTS.medium,
      fontWeight: '500',
    },
    bold: {
      fontFamily: NAV_FONTS.bold,
      fontWeight: '600',
    },
    heavy: {
      fontFamily: NAV_FONTS.heavy,
      fontWeight: '700',
    },
  },
  colors: NAV_THEME.dark,
};
