import { h } from '@wuzzy/static-site';
import { Layout } from '../layout';

export default () => (
  <Layout title="Wuzzy admin">
    <h1 class="text-2xl font-bold">Wuzzy index admin</h1>
    <p class="mt-1 text-sm text-gray-600">
      Read-only view of the store. There is one corpus and indexes are membership views over
      it, so a page two indexes both want is crawled and attested once. This is a separate app
      from the public site and is not reachable from it.
    </p>

    <p id="admin-error" class="mt-4 hidden rounded bg-red-50 px-3 py-2 text-sm text-red-800"></p>

    <section id="stats" class="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4"></section>

    <section class="mt-8">
      <div class="flex items-baseline justify-between">
        <h2 class="text-lg font-semibold">Indexes</h2>
        <span id="index-count" class="text-sm text-gray-600"></span>
      </div>
      <div id="indexes" class="mt-2 overflow-x-auto text-sm"></div>
    </section>

    <section class="mt-8">
      <h2 class="text-lg font-semibold">Sources</h2>
      <div id="hosts" class="mt-2 text-sm"></div>
    </section>

    <section class="mt-8">
      <div class="flex items-baseline justify-between">
        <h2 class="text-lg font-semibold">Documents</h2>
        <span id="doc-count" class="text-sm text-gray-600"></span>
      </div>
      <div class="mt-2 flex flex-wrap gap-2">
        <input
          id="doc-q"
          placeholder="filter by url or title"
          class="flex-1 rounded border border-gray-300 px-3 py-2 text-sm"
        />
        <select id="doc-index" class="rounded border border-gray-300 px-3 py-2 text-sm">
          <option value="">every index</option>
        </select>
        <select id="doc-filter" class="rounded border border-gray-300 px-3 py-2 text-sm">
          <option value="all">all</option>
          <option value="unembedded">not embedded</option>
          <option value="unattested">not attested</option>
          <option value="attested">attested</option>
        </select>
      </div>
      <div id="documents" class="mt-3"></div>
      <div class="mt-3 flex gap-2">
        <button id="prev" class="cursor-pointer rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-100">
          previous
        </button>
        <button id="next" class="cursor-pointer rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-100">
          next
        </button>
      </div>
    </section>

    <section class="mt-8">
      <h2 class="text-lg font-semibold">Recent crawl activity</h2>
      <div id="activity" class="mt-2"></div>
    </section>

    <div id="detail" class="mt-8"></div>

    <script src="/admin.js" defer></script>
  </Layout>
);
