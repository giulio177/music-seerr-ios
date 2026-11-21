// The release workflow passes the git tag version (APP_VERSION) and the build number (APP_BUILD).
module.exports = ({ config }) => ({
  ...config,
  version: process.env.APP_VERSION || config.version,
  ios: {
    ...config.ios,
    buildNumber: process.env.APP_BUILD || config.ios?.buildNumber || '1',
  },
});
