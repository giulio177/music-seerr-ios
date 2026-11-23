import type { SFSymbol } from 'expo-symbols';
import type { Ionicons } from '@expo/vector-icons';
import { Fragment } from 'react';
import { FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { colors, useAccent } from '@/lib/theme';
import { Cover } from './Cover';
import { Symbol } from './Symbol';

export const TILE = 148;

/** Titled section of a page (Home shelves, artist albums, Recently Added). */
export function Shelf({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: 18 }}>
      <Text style={styles.shelfTitle}>
        {title}
        {count ? <Text style={styles.shelfCount}>  {count}</Text> : null}
      </Text>
      {children}
    </View>
  );
}

export type TileItem = {
  key: string;
  title: string;
  sub?: string;
  cover?: string | null;
  local?: string | null;
  fallback?: string | null;
  round?: boolean;
  /** Small label over the artwork (Single, EP). */
  badge?: string;
  onPress: () => void;
};

/** Artwork with a title and a subtitle under it. */
export function Tile({ item, size = TILE }: { item: TileItem; size?: number }) {
  return (
    <Pressable onPress={item.onPress} style={({ pressed }) => ({ width: size, opacity: pressed ? 0.75 : 1 })}>
      <View>
        <Cover path={item.cover} local={item.local} fallback={item.fallback} size={size} round={item.round} />
        {item.badge ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{item.badge}</Text>
          </View>
        ) : null}
      </View>
      <Text numberOfLines={1} style={[styles.tileTitle, item.round && { textAlign: 'center' }]}>
        {item.title}
      </Text>
      {item.sub ? (
        <Text numberOfLines={1} style={[styles.tileSub, item.round && { textAlign: 'center' }]}>
          {item.sub}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** Horizontal row of tiles. */
export function TileRow({ items, size = TILE }: { items: TileItem[]; size?: number }) {
  return (
    <FlatList
      horizontal
      data={items}
      keyExtractor={(item) => item.key}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      renderItem={({ item }) => <Tile item={item} size={size} />}
    />
  );
}

/** Two-column grid of tiles (Recently Added), rendered inline inside a scroll view. */
export function TileGrid({ items }: { items: TileItem[] }) {
  const { width } = useWindowDimensions();
  const size = (width - 16 * 3) / 2;
  return (
    <View style={styles.grid}>
      {items.map((item) => (
        <Tile key={item.key} item={item} size={size} />
      ))}
    </View>
  );
}

export type NavItem = {
  key: string;
  title: string;
  symbol: SFSymbol;
  fallback: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
};

/** Apple Music style list: accent glyph, large label, chevron, separators inset under the label. */
export function NavList({ items }: { items: NavItem[] }) {
  const { accent } = useAccent();
  return (
    <View style={styles.nav}>
      {items.map((item, index) => (
        <Fragment key={item.key}>
          <Pressable onPress={item.onPress} style={({ pressed }) => [styles.navRow, pressed && styles.pressed]}>
            <View style={styles.navIcon}>
              <Symbol name={item.symbol} fallback={item.fallback} size={24} color={accent} />
            </View>
            <Text style={styles.navTitle} numberOfLines={1}>
              {item.title}
            </Text>
            <Symbol name="chevron.right" fallback="chevron-forward" size={14} color={colors.textTertiary} />
          </Pressable>
          {index < items.length - 1 ? <View style={styles.separator} /> : null}
        </Fragment>
      ))}
      <View style={styles.separator} />
    </View>
  );
}

const styles = StyleSheet.create({
  shelfTitle: { color: colors.text, fontSize: 22, fontWeight: '700', paddingHorizontal: 16, marginBottom: 10 },
  shelfCount: { color: colors.textTertiary, fontSize: 16, fontWeight: '600' },
  row: { paddingHorizontal: 16, gap: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, rowGap: 18, paddingHorizontal: 16 },
  tileTitle: { color: colors.text, fontSize: 14, fontWeight: '600', marginTop: 8 },
  tileSub: { color: colors.textSecondary, fontSize: 13, marginTop: 1 },
  badge: { position: 'absolute', left: 6, top: 6, backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  nav: { marginTop: 6 },
  navRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, minHeight: 56, gap: 14 },
  pressed: { backgroundColor: 'rgba(255,255,255,0.05)' },
  navIcon: { width: 30, alignItems: 'center' },
  navTitle: { flex: 1, color: colors.text, fontSize: 20, fontWeight: '400' },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.hairline, marginLeft: 60, marginRight: 16 },
});
