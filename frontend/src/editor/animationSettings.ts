import type { CursorAnimationStyle, ScreenAnimationStyle } from "../motion-engine";

export type { CursorAnimationStyle, ScreenAnimationStyle };

/**
 * The Animations panel (last icon in the sidebar rail) — screen and cursor
 * animation "feel" plus motion blur. Unlike `cursorSettings`/`style`, the
 * two style enums here don't get re-read every `SceneRenderer.draw()` call:
 * they reshape stateful spring/filter machinery instead (see
 * `SceneRenderer.setScreenAnimationStyle`/`setCursorAnimationStyle`), the
 * same way `aspectRatioId` gets its own live setter rather than being
 * passed straight through every frame. `motionBlur` and the two "applies
 * to" toggles *are* plain per-frame multipliers, so those are read directly
 * in `draw()`.
 */
export interface AnimationSettings {
  screenAnimationStyle: ScreenAnimationStyle;
  cursorAnimationStyle: CursorAnimationStyle;
  /** 0-100 master intensity for both the content pan/zoom trail and the
   * cursor motion blur — see `renderer.ts`'s `MAX_TRAIL_*`/`MAX_CURSOR_BLUR_PX`
   * constants, which this scales rather than replaces. */
  motionBlur: number;
  /** Advanced: independently mute either half of the blur without touching
   * the shared intensity slider above. */
  motionBlurAppliesToScreen: boolean;
  motionBlurAppliesToCursor: boolean;
}

export const DEFAULT_ANIMATION_SETTINGS: AnimationSettings = {
  screenAnimationStyle: "focused",
  cursorAnimationStyle: "smooth",
  motionBlur: 90,
  motionBlurAppliesToScreen: true,
  motionBlurAppliesToCursor: true,
};
