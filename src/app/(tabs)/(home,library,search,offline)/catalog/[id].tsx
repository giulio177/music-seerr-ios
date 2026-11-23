import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Cover } from '@/components/Cover';
import { MissingRow, type ReleaseTrack } from '@/components/MissingRow';
import { ErrorState, Loading } from '@/components/ui';
import { useRequests } from '@/lib/requests';
import { colors, useAccent } from '@/lib/theme';
import { useApi } from '@/lib/useApi';

type Response = {
  album: { id: string; title: string; artist: string; cover_url?: string | null; year?: string | null; record_type?: string };
  tracks: ReleaseTrack[];
};

/** A release the library does not have (from an artist page): preview its songs and request them. */
export default function CatalogAlbum() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const { accent } = useAccent();
  const { data, error, loading, reload } = useApi<Response>(`/api/catalog/album/${id}`);
  const { jobs, request, requestAll } = useRequests();

  if (loading) return <Loading />;
  if (error || !data) return error ? <ErrorState error={error} onRetry={reload} /> : null;

  const pending = data.tracks.filter((tr) => !tr.in_jellyfin && !jobs[tr.id]);
  const owned = data.tracks.filter((tr) => tr.in_jellyfin).length;

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: data.album.title, headerLargeTitle: false }} />
      <FlatList
        data={data.tracks}
        keyExtractor={(item) => item.id}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: 140 }}
        ListHeaderComponent={
          <View style={styles.header}>
            <Cover path={data.album.cover_url} size={230} shadow />
            <Text style={styles.title}>{data.album.title}</Text>
            <Text style={styles.subtitle}>{[data.album.artist, data.album.year].filter(Boolean).join(' · ')}</Text>
            <Text style={styles.note}>
              {owned ? t('detail.ownedOf', { owned, total: data.tracks.length }) : t('detail.notInLibraryHint')}
            </Text>
            {pending.length ? (
              <Pressable onPress={() => requestAll(pending)} style={styles.link}>
                <Ionicons name="add-circle-outline" size={20} color={accent} />
                <Text style={[styles.linkLabel, { color: accent }]}>{t('detail.requestMissing', { count: pending.length })}</Text>
              </Pressable>
            ) : null}
          </View>
        }
        renderItem={({ item }) => <MissingRow track={item} job={jobs[item.id]} onRequest={() => request(item)} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 },
  title: { color: colors.text, fontSize: 24, fontWeight: '800', textAlign: 'center', marginTop: 18 },
  subtitle: { color: colors.textSecondary, fontSize: 16, marginTop: 4, textAlign: 'center' },
  note: { color: colors.textTertiary, fontSize: 13, marginTop: 10, textAlign: 'center' },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10 },
  linkLabel: { fontSize: 14, fontWeight: '600' },
});
