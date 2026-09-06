import { h } from '@wuzzy/static-site';
import { Layout } from '../layout';

export default () => (
  <Layout title="Document - Wuzzy admin" active="/documents">
    <a data-nav href="/documents" class="text-sm underline">
      back to documents
    </a>
    {/* Filled from ?id=, so a document is a link an operator can share. */}
    <div id="detail" class="mt-4"></div>
  </Layout>
);
