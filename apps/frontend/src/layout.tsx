import { h, type Children } from '@wuzzy/static-site';
import { site } from './site.config';

/**
 * The shell every public page renders into.
 *
 * The brand is carried over from the legacy wuzzy.io: Berkeley Mono, black on
 * white, uppercase headings, 2px rules, and no accent colour. Nothing else
 * came across, so there is no framework here and no client-side router.
 */
export const Layout = ({
  title,
  /** Large centred mark, as the legacy site did on its own home page only. */
  hero = false,
  children,
}: {
  title: string;
  hero?: boolean;
  children?: Children;
}) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title}</title>
      <meta name="description" content={site.description} />
      <link rel="icon" type="image/png" href="/favicon.png" />

      <meta property="og:site_name" content={site.name} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={site.description} />
      <meta property="og:type" content="website" />
      <meta property="og:url" content={site.origin} />
      <meta property="og:image" content={`${site.origin}/brand/wuzzy-og.png`} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={site.description} />
      <meta name="twitter:image" content={`${site.origin}/brand/wuzzy-og.png`} />

      <link rel="stylesheet" href="/styles.css" />
    </head>
    <body class="bg-paper text-ink flex min-h-screen flex-col px-4">
      <header class={hero ? 'pt-16 pb-8 text-center' : 'py-6'}>
        <a href="/" class={hero ? 'block no-underline' : 'inline-flex items-center gap-3 no-underline'}>
          <img
            src="/brand/wuzzy-logo.png"
            alt=""
            width={hero ? 128 : 32}
            height={hero ? 128 : 32}
            class={hero ? 'mx-auto size-32' : 'size-8'}
          />
          <span class={hero ? 'mt-4 block text-2xl font-bold uppercase' : 'text-lg font-semibold'}>
            {site.name}
          </span>
        </a>
      </header>

      <main class="mx-auto w-full max-w-[76ch] flex-1 pb-16">{children}</main>

      <Footer />
    </body>
  </html>
);

const FOOTER_LINKS = [
  { href: site.repo, label: 'GitHub' },
  { href: `${site.repo}/blob/master/VERIFY.md`, label: 'Verify' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
  { href: `mailto:${site.contactEmail}`, label: 'Contact' },
  { href: site.social.href, label: site.social.label },
];

const Footer = () => (
  <footer class="border-ink mt-auto border-t-2 py-8 text-center text-sm">
    <img src="/brand/wuzzy-mark.png" alt="" width="32" height="32" class="mx-auto size-8" />
    <p class="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-1">
      {FOOTER_LINKS.map((link) => (
        <a href={link.href} class="underline">
          {link.label}
        </a>
      ))}
    </p>
    <p class="text-ink-muted mt-3">
      Built and operated by{' '}
      <a href={site.operator.href} class="underline">
        {site.operator.name}
      </a>
    </p>
  </footer>
);
