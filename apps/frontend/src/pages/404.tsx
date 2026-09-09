import { h } from '@wuzzy/static-site';
import { Layout } from '../layout';
import { site } from '../site.config';

/**
 * Rendered to 404.html, which is what Cloudflare Pages serves for a path that
 * does not exist. Without it Pages falls back to index.html with a 200, so a
 * mistyped URL and a real page are indistinguishable to anything that reads
 * status codes: a crawler indexes the same page many times over, and an agent
 * probing for a file it hopes exists gets HTML and a success.
 *
 * Excluded from the sitemap and llms.txt by the builder, since it is a state
 * the site can be in rather than somewhere to send anybody.
 */
export default () => (
  <Layout title={`Not found - ${site.name}`}>
    <main class="mx-auto max-w-[60ch] px-6 py-24">
      <p class="text-sm uppercase tracking-widest opacity-60">404</p>
      <h1 class="mt-4 text-3xl font-medium">That page is not here.</h1>
      <p class="mt-6 opacity-80">
        The link may be old, or the address mistyped. Nothing was crawled and nothing was
        charged.
      </p>
      <p class="mt-8">
        <a class="underline" href="/">
          Back to {site.name}
        </a>
        {' · '}
        <a class="underline" href={site.docsOrigin}>
          Docs
        </a>
      </p>
    </main>
  </Layout>
);
