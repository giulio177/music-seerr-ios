import { useLocalSearchParams } from 'expo-router';
import { CollectionScreen } from '@/screens/Collection';

export default function PlaylistPage() {
  const { id, downloaded } = useLocalSearchParams<{ id: string; downloaded?: string }>();
  return <CollectionScreen kind="playlist" id={id} downloaded={downloaded === '1'} />;
}
