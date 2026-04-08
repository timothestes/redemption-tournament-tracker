import { redirect } from 'next/navigation';

interface Props {
  params: Promise<{ code: string }>;
}

export default async function SpectatePage({ params }: Props) {
  // Spectator mode is postponed — redirect to play lobby
  redirect('/play');
}
