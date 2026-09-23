/**
 * The three Home views are one page with a control on it, not three pages.
 * They're separate paths only so a scenario is shareable. Anything keyed to
 * "a route change" (scroll reset, remounting the routed view) should treat a
 * move between these paths as a control interaction, not a navigation.
 */
export const HOME_VIEW_PATHS: ReadonlySet<string> = new Set(['/', '/retrospective', '/sandbox']);
