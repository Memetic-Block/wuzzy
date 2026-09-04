import { h } from '../jsx/jsx-runtime';
import { Layout } from '../layout';

export default () => (
  <Layout title="Wuzzy">
    <h1 class="text-3xl font-bold">Wuzzy</h1>
    <p class="mt-3 text-lg text-gray-700">
      A search index for AI agents, where every result carries onchain proof of what was
      crawled and when.
    </p>
    <p class="mt-6 text-sm text-gray-600">
      Search is coming. In the meantime the crawler runs in the open as{' '}
      <code class="rounded bg-gray-100 px-1 py-0.5">WuzzyBot</code>, respects robots.txt, and
      publishes a content hash for every page it indexes.
    </p>
  </Layout>
);
