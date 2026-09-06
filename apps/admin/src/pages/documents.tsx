import { h } from '@wuzzy/static-site';
import { Layout } from '../layout';

export default () => (
  <Layout title="Documents - Wuzzy admin" active="/documents">
    <div class="flex items-baseline justify-between">
      <h1 class="text-2xl font-bold">Documents</h1>
      <span id="doc-count" class="text-sm text-gray-600"></span>
    </div>

    <div class="mt-4 flex flex-wrap gap-2">
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
        <option value="unindexed">unindexed</option>
      </select>
    </div>

    <div id="documents" class="mt-4 overflow-x-auto"></div>

    <div class="mt-4 flex items-center gap-2">
      <button
        id="prev"
        class="cursor-pointer rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-100 disabled:cursor-default disabled:opacity-40"
      >
        Previous
      </button>
      <button
        id="next"
        class="cursor-pointer rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-100 disabled:cursor-default disabled:opacity-40"
      >
        Next
      </button>
    </div>
  </Layout>
);
