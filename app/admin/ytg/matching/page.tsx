import { getSupabaseAdmin } from '@/lib/pricing/supabase-admin';
import MatchingDashboard from './components/MatchingDashboard';
import BackfillPanel from './components/BackfillPanel';
import ReviewQueue from './components/ReviewQueue';

export const metadata = { title: "YTG Store — Matching" };
export const dynamic = 'force-dynamic';

async function loadDashboardCounts(): Promise<{ byMethod: Record<string, number>; byStatus: Record<string, number> }> {
  const supabase = getSupabaseAdmin();
  const byMethod: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from('card_price_mappings')
      .select('match_method, status')
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const m = row.match_method ?? 'none';
      byMethod[m] = (byMethod[m] ?? 0) + 1;
      byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
    }
    if (!data || data.length < pageSize) break;
  }
  return { byMethod, byStatus };
}

export default async function MatchingPage() {
  const counts = await loadDashboardCounts();
  return (
    <div className="space-y-6">
      <MatchingDashboard byMethod={counts.byMethod} byStatus={counts.byStatus} />
      <BackfillPanel />
      <ReviewQueue />
    </div>
  );
}
