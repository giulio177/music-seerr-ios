// The release workflow passes the git tag version (APP_VERSION), the build number (APP_BUILD), the commit
// (APP_COMMIT), and the variant (VARIANT: release or development), shown in Settings.
module.exports = ({ config }) => ({
  ...config,
  version: process.env.APP_VERSION || config.version,
  ios: {
    ...config.ios,
    buildNumber: process.env.APP_BUILD || config.ios?.buildNumber || '1',
  },
  extra: {
    ...config.extra,
    commit: process.env.APP_COMMIT || null,
    variant: process.env.VARIANT || null,
  },
});
