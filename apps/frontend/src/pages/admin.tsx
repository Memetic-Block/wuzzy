import { h } from '../jsx/jsx-runtime';
import { Layout } from '../layout';

export default () => (
  <Layout title="Wuzzy admin">
    <div class="flex items-baseline justify-between">
      <h1 class="text-2xl font-bold">Index admin</h1>
      <a class="text-sm underline" href="/">
        back to search
      </a>
    </div>
    <p class="mt-1 text-sm text-gray-600">
      Read-only view of the global index. There is one corpus: documents, their provenance
      trail, and their chunks.
    </p>

    <p id="admin-error" class="mt-4 hidden rounded bg-red-50 px-3 py-2 text-sm text-red-800"></p>

    <section id="stats" class="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4"></section>

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
