import type { SettingsCatalogue } from './en-GB';

export const EN_US_SETTINGS: SettingsCatalogue = {
  // #618: Features, Experimental, Web address and Backups pages
  'features.experimentalIntro': "Try alternative application logic for everyone on this server. Each experiment describes the behavior it changes. Turn it off to restore the existing logic. These experiments are not quality-validated.",
  'features.item.stepSupervision.description': "Let a decision provider advise whether to continue, verify tool results or pause for review between chat steps. Keeps existing behavior if unavailable. Approvals and execution limits still apply.",
  'decision.deadlineHelp': "If the service cannot answer in time, Noevia keeps its existing behavior. Range: 100–2000 ms.",
  'settings.keywords.connectors': 'connectors google drive customize customise plugins skills permissions',
  'appearance.logo': 'Logo colors',
  'appearance.logoDesc': 'Default leaves, seasonal colors or monthly occasions. Saved on this device; the favicon stays unchanged.',
  'appearance.logo.calendarDesc': 'Uses this device’s local date. Monthly occasions use seasonal colors in the other months.',
  'appearance.accentDesc': 'Color for selections, links and the send button.',
  'appearance.family.glass': 'Frosted, translucent panes with a bright edge over a soft color field.',
  'appearance.preview.message': 'Summarize the notes',
  'usage.favouriteModel': 'Favorite model',
  'connectors.drive.suggestFind': 'Find my Drive file about backups and summarize it',
  'serviceStatus.mcp.catalogueUnavailable': 'Catalog unavailable',
  'serviceStatus.mcp.cacheNote': 'Catalog checks are cached for up to ten minutes. A listed tool can still fail if its credentials or permissions change. Your selected toolboxes and write approvals still control execution.',
};
