/**
 * Stands in for `@cio/ui/custom/moving-icons` in unit tests.
 *
 * The navigation config imports icon components purely to attach them to menu
 * entries; none of the logic under test reads them. The real module is Svelte
 * source, which the node-environment test runner cannot load without the Svelte
 * plugin — so tests alias it here (see `vitest.config.ts`) rather than pulling a
 * component compiler into a plain logic suite.
 */
const Icon = () => null;

/** Covers `import BotIcon from '@lucide/svelte/icons/bot'`-style default imports. */
export default Icon;

export const ApiIcon = Icon;
export const AttachmentIcon = Icon;
export const ChartColumnIcon = Icon;
export const CommunityIcon = Icon;
export const CourseIcon = Icon;
export const DashboardIcon = Icon;
export const GoalIcon = Icon;
export const HomeIcon = Icon;
export const HoverableItem = Icon;
export const LandingPageIcon = Icon;
export const PeopleIcon = Icon;
export const PremiumIcon = Icon;
export const SettingsIcon = Icon;
export const SetupIcon = Icon;
export const TagIcon = Icon;
export const ZapIcon = Icon;
