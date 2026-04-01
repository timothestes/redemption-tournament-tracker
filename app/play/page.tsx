import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';
import TopNav from '@/components/top-nav';
import { GameLobby } from './components/GameLobby';

export const metadata = {
  title: 'Play Online | RedemptionCCG',
  description: 'Create or join an online game',
};

export default async function PlayPage({ searchParams }: { searchParams: Promise<{ join?: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const params = await searchParams;
    const returnPath = params.join ? `/play?join=${encodeURIComponent(params.join)}` : '/play';
    redirect(`/sign-in?redirectTo=${encodeURIComponent(returnPath)}`);
  }

  const { data: decks } = await supabase
    .from('decks')
    .select('id, name, format, card_count, preview_card_1, preview_card_2, paragon')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  return (
    <>
    <TopNav />
    <div className="container mx-auto px-4 py-8 max-w-lg">
      <h1 className="text-3xl font-bold mb-8 font-cinzel jayden-gradient-text">Play Online</h1>
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
    </>
  );
}
