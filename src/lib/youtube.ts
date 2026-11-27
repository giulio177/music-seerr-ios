import { router } from 'expo-router';

/** True for a YouTube or YouTube Music link, with a video ID, so the Search field can hand a pasted link to the link screen. */
export function isYouTubeLink(text: string) {
  return /^(https?:\/\/)?((www|m|music)\.)?(youtube\.com\/(watch\?\S*v=|shorts\/|live\/)|youtu\.be\/)[\w-]{11}/i.test(text.trim());
}

/** Opens the "From a YouTube link" screen, optionally reading `url` at once. */
export function openYouTubeLink(url?: string) {
  router.push(url ? { pathname: '/youtube-link', params: { url: url.trim() } } : '/youtube-link');
}
