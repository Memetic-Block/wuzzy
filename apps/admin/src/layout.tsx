import { h, type Children } from '@wuzzy/static-site';

/** Pages in the order an operator moves through them. */
const NAV = [
  { href: '/', label: 'Overview' },
  { href: '/indexes', label: 'Indexes' },
  { href: '/documents', label: 'Documents' },
  { href: '/activity', label: 'Activity' },
];

export const Layout = ({
  title,
  active,
  children,
}: {
  title: string;
  /** Which nav entry to mark as current, by href. */
  active?: string;
  children?: Children;
}) => (
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
      <header class="border-b border-gray-200">
        <nav class="mx-auto flex max-w-5xl items-center gap-1 px-4 py-3 text-sm">
          <span class="mr-3 font-semibold">Wuzzy admin</span>
          {NAV.map((item) => (
            <a
              href={item.href}
              /* Rewritten at runtime to carry ?token= so navigating does not
                 drop the credential the operator arrived with. */
              data-nav
              class={
                item.href === active
                  ? 'rounded bg-gray-900 px-3 py-1 text-white'
                  : 'rounded px-3 py-1 hover:bg-gray-100'
              }
            >
              {item.label}
            </a>
          ))}
        </nav>
      </header>
      <main class="mx-auto max-w-5xl px-4 py-8">
        <p id="admin-error" class="mb-4 hidden rounded bg-red-50 px-3 py-2 text-sm text-red-800"></p>
        {children}
      </main>
      <script src="/admin.js" defer></script>
    </body>
  </html>
);
