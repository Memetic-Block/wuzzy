import { h } from '@wuzzy/static-site';
import { Layout } from '../layout';

export default () => (
  <Layout title="Wuzzy">
    <h1 class="text-3xl font-bold">Wuzzy</h1>
    <p class="mt-3 text-lg text-gray-700">
      A search index for AI agents, where every result carries onchain proof of what was
      crawled and when.
    </p>

    <form id="search-form" class="mt-8 flex flex-wrap gap-2">
      <input
        id="query"
        name="query"
        required
        autocomplete="off"
        placeholder="Ask the index something"
        class="flex-1 rounded border border-gray-300 px-3 py-2"
      />
      {/* Populated from the public catalog, and hidden while there is only one
          index to choose, so the control appears when it means something. */}
      <select
        id="index"
        name="index"
        hidden
        class="rounded border border-gray-300 px-3 py-2"
      ></select>
      <button
        type="submit"
        class="cursor-pointer rounded border border-gray-300 px-4 py-2 hover:bg-gray-100"
      >
        Search
      </button>
    </form>

    <p id="status" class="mt-3 text-sm text-gray-600"></p>
    <div id="results" class="mt-6"></div>

    <p class="mt-12 border-t border-gray-200 pt-4 text-sm text-gray-600">
      Every result carries the hash of the exact content that was indexed, produced by a
      pinned public procedure. Third parties can re-derive it and check the attestation
      themselves.
    </p>

    <script src="/search.js" defer></script>
  </Layout>
);
