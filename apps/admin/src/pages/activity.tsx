import { h } from '@wuzzy/static-site';
import { Layout } from '../layout';

export default () => (
  <Layout title="Activity - Wuzzy admin" active="/activity">
    <h1 class="text-2xl font-bold">Crawl activity</h1>
    <p class="mt-1 text-sm text-gray-600">
      Every request the crawler made, including the ones that returned nothing usable. A URL
      that was never requested, because robots disallowed it or a redirect left the seeded
      hosts, is deliberately absent: the trail records fetches, not intentions.
    </p>

    <div class="mt-4 flex flex-wrap gap-2">
      <select id="act-filter" class="rounded border border-gray-300 px-3 py-2 text-sm">
        <option value="all">everything</option>
        <option value="failed">failures only</option>
        <option value="skipped">skipped only</option>
        <option value="changed">content changed</option>
      </select>
      <select id="act-limit" class="rounded border border-gray-300 px-3 py-2 text-sm">
        <option value="50">50 rows</option>
        <option value="100">100 rows</option>
        <option value="200">200 rows</option>
      </select>
    </div>

    <div id="activity" class="mt-4 overflow-x-auto"></div>
  </Layout>
);
