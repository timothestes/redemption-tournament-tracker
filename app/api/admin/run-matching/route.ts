import { NextResponse } from 'next/server';
import { hasPermission } from '@/utils/adminUtils';
import { runMatchingPipeline } from '@/lib/pricing/matching';

export async function POST() {
  if (!(await hasPermission('manage_shopify_imports'))) {
    return NextResponse.json({ error: 'Shopify import permission required' }, { status: 403 });
  }
  try {
    const summary = await runMatchingPipeline();
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
