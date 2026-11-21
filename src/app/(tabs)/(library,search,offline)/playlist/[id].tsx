import { useLocalSearchParams } from 'expo-router';
import { CollectionScreen } from '@/screens/Collection';

export default function PlaylistPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CollectionScreen kind="playlist" id={id} />;
}
