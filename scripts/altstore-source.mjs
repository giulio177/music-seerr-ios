// Prints the AltStore / SideStore source for the release being built.
// Usage: node scripts/altstore-source.mjs Sonalis.ipa > altstore-source.json
// Reads APP_VERSION, APP_BUILD, GITHUB_REPOSITORY, and GITHUB_REF_NAME from the environment.
import { statSync } from 'node:fs';
import { basename } from 'node:path';

const ipa = process.argv[2];
const repo = process.env.GITHUB_REPOSITORY ?? 'giulio177/sonalis-ios';
const tag = process.env.GITHUB_REF_NAME ?? `v${process.env.APP_VERSION}`;
const version = process.env.APP_VERSION;
const base = `https://github.com/${repo}`;

const source = {
  name: 'Sonalis',
  identifier: 'io.github.giulio177.sonalis.source',
  subtitle: 'iOS client for a self-hosted Sonalis server',
  sourceURL: `${base}/releases/latest/download/altstore-source.json`,
  iconURL: `https://raw.githubusercontent.com/${repo}/main/assets/icon.png`,
  tintColor: '#f94c84',
  apps: [
    {
      name: 'Sonalis',
      bundleIdentifier: 'io.github.giulio177.sonalis',
      developerName: 'giulio177',
      subtitle: 'Your Jellyfin music, online and offline',
      localizedDescription:
        'Browse and play your Jellyfin music library through Sonalis, request new songs, and download music for offline listening.',
      iconURL: `https://raw.githubusercontent.com/${repo}/main/assets/icon.png`,
      tintColor: '#f94c84',
      category: 'entertainment',
      screenshots: [],
      versions: [
        {
          version,
          buildVersion: process.env.APP_BUILD ?? '1',
          date: new Date().toISOString(),
          localizedDescription: `See ${base}/releases/tag/${tag}`,
          downloadURL: `${base}/releases/download/${tag}/${basename(ipa)}`,
          size: statSync(ipa).size,
          minOSVersion: '16.4',
        },
      ],
      appPermissions: {
        entitlements: [],
        privacy: {
          NSLocalNetworkUsageDescription: 'Sonalis connects to your Sonalis server on your home network.',
        },
      },
    },
  ],
  news: [],
};

process.stdout.write(JSON.stringify(source, null, 2) + '\n');
