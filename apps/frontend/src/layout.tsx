import { h, type Children } from '@wuzzy/static-site';
import { site } from './site.config';

/**
 * The shell every public page renders into.
 *
 * One 53rem column, a 1.5px rule above and below it, and nothing between the
 * header and the content. The rules are 1.5px rather than 1 or 2 on purpose:
 * they are the heaviest line on the page and they have to out-weigh the 1px
 * hairlines that divide the sections without reading as a box.
 *
 * There is no framework here and no client-side router. The one script on the
 * site is the search box's, and it is loaded by the page that has one.
 */
export const Layout = ({ title, children }: { title: string; children?: Children }) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title}</title>
      <meta name="description" content={site.description} />
      <link rel="icon" type="image/png" href="/favicon.png" />

      <meta property="og:site_name" content={site.name} />
      <meta property="og:title" content={site.socialTitle} />
      <meta property="og:description" content={site.description} />
      <meta property="og:type" content="website" />
      <meta property="og:url" content={site.origin} />
      <meta property="og:image" content={`${site.origin}/brand/wuzzy-og.png`} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={site.socialTitle} />
      <meta name="twitter:description" content={site.description} />
      <meta name="twitter:image" content={`${site.origin}/brand/wuzzy-og.png`} />

      <link rel="stylesheet" href="/styles.css" />
    </head>
    <body class="bg-paper text-ink px-5">
      <div class="max-w-page mx-auto flex min-h-screen flex-col">
        <Header />
        <main class="flex-1">{children}</main>
        <Footer />
      </div>
    </body>
  </html>
);

/**
 * Mark, wordmark and its descriptor on the left; the four things a reviewer
 * goes looking for on the right. Baseline-aligned rather than centred, so the
 * nav sits on the same line as the wordmark and not on the descriptor.
 */
const Header = () => (
  <header class="border-ink flex flex-wrap items-end justify-between gap-4 border-b-[1.5px] pt-[22px] pb-[14px]">
    <a href="/" class="flex items-center gap-3 text-inherit no-underline">
      <img src="/brand/wuzzy-logo.png" alt="Wuzzy" width="30" height="30" class="block size-[30px]" />
      <span class="flex flex-col gap-px">
        <span class="text-wordmark tracking-h3 font-semibold" style="line-height:1.1">
          {site.name}
        </span>
        <span class="text-sub text-ink-muted tracking-wordmark">{site.wordmarkSubtitle}</span>
      </span>
    </a>
    <nav class="text-note flex gap-[18px] pb-0.5">
      {HEADER_LINKS.map((link) => (
        <NavLink href={link.href} label={link.label} />
      ))}
    </nav>
  </header>
);

/**
 * Where to learn it, where the source is, and how to check it. The legal pages
 * are not here: they belong to the footer, which is where a reader looks for
 * them, and putting them in the bar spends the most valuable row on the page
 * on the two links nobody arrives wanting.
 */
/**
 * A link in the header or the footer.
 *
 * Leaving the site opens a tab rather than replacing the one the reader is
 * using, and that is decided by the href rather than by a flag on each link, so
 * a link added later cannot be added wrong. `mailto:` is left alone: handing it
 * to a new tab opens a blank window next to the mail client.
 */
const NavLink = ({ href, label }: { href: string; label: string }) =>
  /^https?:/.test(href) ? (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {label}
    </a>
  ) : (
    <a href={href}>{label}</a>
  );

const HEADER_LINKS = [
  { href: '/about', label: 'About' },
  { href: '/roadmap', label: 'Roadmap' },
  { href: site.docsOrigin, label: 'Docs' },
  { href: site.repo, label: 'GitHub' },
  { href: `${site.repo}/blob/master/VERIFY.md`, label: 'VERIFY.md' },
];

const FOOTER_LINKS = [
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
  { href: `mailto:${site.contactEmail}`, label: 'Contact' },
];

const Footer = () => (
  <footer class="border-ink text-note text-ink-muted mt-auto flex flex-wrap items-center gap-[18px] border-t-[1.5px] pt-4 pb-10">
    <img src="/brand/wuzzy-mark.png" alt="" width="20" height="20" class="block size-5 opacity-75" />
    <span>
      Built by <NavLink href={site.operator.href} label={site.operator.name} />
    </span>
    {FOOTER_LINKS.map((link) => (
      <NavLink href={link.href} label={link.label} />
    ))}
  </footer>
);
