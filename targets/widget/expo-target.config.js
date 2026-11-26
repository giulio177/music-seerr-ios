// Widget extension with the Control Center controls (Controls.swift). Files in `_shared/` are also built into the
// app target: the App Intents for Siri, Shortcuts, and Spotlight live there. See AGENTS.md "Shortcuts".
/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: 'widget',
  name: 'SonalisControls',
  displayName: 'Sonalis',
  bundleIdentifier: '.controls',
  deploymentTarget: '26.0',
  frameworks: ['SwiftUI', 'WidgetKit', 'AppIntents'],
};
