import { useLocalSearchParams } from 'expo-router';
import { CollectionScreen } from '@/screens/Collection';

export default function ArtistPage() {
  const { id, downloaded } = useLocalSearchParams<{ id: string; downloaded?: string }>();
  return <CollectionScreen kind="artist" id={id} downloaded={downloaded === '1'} />;
}
