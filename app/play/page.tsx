import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';
import { GameLobby } from './components/GameLobby';

export const metadata = {
  title: 'Multiplayer | RedemptionCCG',
  description: 'Create or join a multiplayer game',
};

export default async function PlayPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/sign-in');
  }

  const { data: decks } = await supabase
    .from('decks')
    .select('id, name, format, card_count')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <h1 className="text-3xl font-bold mb-8 font-cinzel">Multiplayer</h1>
      <GameLobby
        decks={decks || []}
        userId={user.id}
        displayName={
          user.user_metadata?.display_name ||
          user.email?.split('@')[0] ||
          'Player'
        }
      />
    </div>
  );
}
