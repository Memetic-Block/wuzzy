import { h, type Children } from './jsx/jsx-runtime';

export const Layout = ({ title, children }: { title: string; children?: Children }) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title}</title>
      <link rel="stylesheet" href="/styles.css" />
      <script src="/htmx.min.js" defer></script>
    </head>
    <body class="leading-relaxed">
      <main class="mx-auto max-w-2xl px-4 py-16">{children}</main>
    </body>
  </html>
);
