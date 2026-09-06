import { h } from '@wuzzy/static-site';
import { Layout } from '../layout';

export default () => (
  <Layout title="Indexes - Wuzzy admin" active="/indexes">
    <div class="flex items-baseline justify-between">
      <h1 class="text-2xl font-bold">Indexes</h1>
      <span id="index-count" class="text-sm text-gray-600"></span>
    </div>
    <p class="mt-1 text-sm text-gray-600">
      Every index is the same primitive configured differently. Pages counts what an index can
      see, not what it owns exclusively. Select one to browse its documents.
    </p>

    <div id="indexes" class="mt-4 overflow-x-auto text-sm"></div>
  </Layout>
);
