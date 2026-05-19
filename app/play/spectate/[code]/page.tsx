import { createClient } from '@/utils/supabase/server';
import { SpectatorClient } from './client';

interface Props {
  params: Promise<{ code: string }>;
}

export default async function SpectatePage({ params }: Props) {
  const { code } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let displayName = 'Spectator';
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('username')
      .eq('id', user.id)
      .single();
    displayName =
      profile?.username ||
      user.user_metadata?.display_name ||
      user.email?.split('@')[0] ||
      'Spectator';
  }

  return <SpectatorClient code={code} displayName={displayName} />;
}
