import { useLocalSearchParams } from 'expo-router';
import { CollectionScreen } from '@/screens/Collection';

export default function AlbumPage() {
  const { id, downloaded } = useLocalSearchParams<{ id: string; downloaded?: string }>();
  return <CollectionScreen kind="album" id={id} downloaded={downloaded === '1'} />;
}
