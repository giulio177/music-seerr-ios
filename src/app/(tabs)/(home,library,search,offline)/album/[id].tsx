import { useLocalSearchParams } from 'expo-router';
import { CollectionScreen } from '@/screens/Collection';

export default function AlbumPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CollectionScreen kind="album" id={id} />;
}
