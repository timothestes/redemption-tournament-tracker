import { NextResponse } from 'next/server';
import { runMatchingPipeline } from '@/lib/pricing/matching';

export async function POST() {
  try {
    const summary = await runMatchingPipeline();
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
