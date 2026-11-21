import { useLocalSearchParams } from 'expo-router';
import { CollectionScreen } from '@/screens/Collection';

export default function ArtistPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CollectionScreen kind="artist" id={id} />;
}
