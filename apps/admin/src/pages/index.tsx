import { h } from '@wuzzy/static-site';
import { Layout } from '../layout';

export default () => (
  <Layout title="Wuzzy admin" active="/">
    <h1 class="text-2xl font-bold">Overview</h1>
    <p class="mt-1 text-sm text-gray-600">
      One shared document store. Indexes are membership views over it, so a page two indexes
      both want is crawled and attested once.
    </p>

    <section id="stats" class="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4"></section>

    <section class="mt-8">
      <h2 class="text-lg font-semibold">Sources</h2>
      <p class="text-sm text-gray-600">Which sites the corpus came from.</p>
      <div id="hosts" class="mt-2 text-sm"></div>
    </section>
  </Layout>
);
