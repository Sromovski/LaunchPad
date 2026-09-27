/** Output geometry and platform safe zones (CLAUDE.md §6). */
export const W = 1080;
export const H = 1920;
export const FPS = 30;

/** Platform UI covers the bottom 20% and right 12%: keep captions/credits out. */
export const UNSAFE_BOTTOM = Math.round(H * 0.2); // 384 px
export const UNSAFE_RIGHT = Math.round(W * 0.12); // 130 px
export const SAFE_RIGHT_X = W - UNSAFE_RIGHT; // 950
export const SAFE_BOTTOM_Y = H - UNSAFE_BOTTOM; // 1536

export const END_CARD_MIN_S = 3;
export const KENBURNS_MAX_ZOOM = 1.15;

export const FONTS_DIR = 'assets/fonts';
export const FONT_BOLD = 'Fredoka';
export const FONT_SEMIBOLD = 'Fredoka SemiBold';
