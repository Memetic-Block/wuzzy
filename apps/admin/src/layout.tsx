import { h, type Children } from '@wuzzy/static-site';

export const Layout = ({ title, children }: { title: string; children?: Children }) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title}</title>
      {/* No indexing, ever: this is an operator tool, not a page. */}
      <meta name="robots" content="noindex, nofollow" />
      <link rel="stylesheet" href="/styles.css" />
    </head>
    <body class="leading-relaxed">
      <main class="mx-auto max-w-5xl px-4 py-10">{children}</main>
    </body>
  </html>
);
