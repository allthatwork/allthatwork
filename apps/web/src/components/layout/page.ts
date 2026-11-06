/**
 * The dashboard page container: the whole content area, 32px on each side (16px on phones). No max width, so a page
 * uses the screen on big monitors. Pages add their own layout (grid, gaps) next to it.
 */
export const PAGE_CLASS = "w-full px-8 py-8 max-sm:px-4 max-sm:py-5";

/**
 * Marks a page that fills the window's height (less the guest banner) instead of scrolling, like the Applications
 * board. The app shell lays out as a column when its page carries it; the page then takes `flex-1 basis-0 min-h-0`.
 */
export const FILL_SCREEN_ATTRIBUTE = "data-fill-screen";
