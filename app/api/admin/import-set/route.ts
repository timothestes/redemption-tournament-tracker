import { NextRequest, NextResponse } from 'next/server';
import { isRegistrationAdmin } from '@/utils/adminUtils';
import { planSetImport, executeImport, listImportableSets, type ImportRequest } from '@/lib/shopify/importSet';

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!(await isRegistrationAdmin())) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }
  try {
    const setCode = request.nextUrl.searchParams.get('set');
    if (!setCode) return NextResponse.json({ sets: listImportableSets() });
    const plans = await planSetImport(setCode);
    if (plans.length === 0) return NextResponse.json({ error: `Unknown set: ${setCode}` }, { status: 400 });
    return NextResponse.json({ setCode, plans });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!(await isRegistrationAdmin())) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const { setCode, status, dryRun, cards } = body as ImportRequest & { dryRun?: boolean };
    if (!setCode || (status !== 'DRAFT' && status !== 'ACTIVE') || !Array.isArray(cards)) {
      return NextResponse.json({ error: 'setCode, status (DRAFT|ACTIVE) and cards[] are required' }, { status: 400 });
    }
    if (dryRun) return NextResponse.json({ plans: await planSetImport(setCode) });
    const { results, summary } = await executeImport({ setCode, status, cards });
    return NextResponse.json({ results, summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
