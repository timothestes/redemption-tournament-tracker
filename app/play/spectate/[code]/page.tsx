import { SpectatorClient } from './client';

interface Props {
  params: Promise<{ code: string }>;
}

export default async function SpectatePage({ params }: Props) {
  const { code } = await params;
  return <SpectatorClient code={code} />;
}
