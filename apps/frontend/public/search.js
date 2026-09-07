// The free human search box. Posts to /web-search, which is unmetered and
// rate-limited by IP; the paid /search contract is untouched by anything here.
//
// Plain fetch rather than a framework: the route answers the same JSON a paying
// agent gets, so this page needs no second, HTML-shaped endpoint beside it. The
// attestation link on each result is the reason the box exists at all.
(function () {
  var form = document.getElementById('search-form');
  var input = document.getElementById('query');
  var status = document.getElementById('status');
  var results = document.getElementById('results');
  var pager = document.getElementById('pager');
  var prev = document.getElementById('prev');
  var next = document.getElementById('next');
  var pageOf = document.getElementById('page-of');

  if (!form) return;

  var PAGE = 10;
  // The query a page belongs to, so a stale response cannot repaint the
  // results of a newer one, and so paging pages what is on screen.
  var current = { query: '', offset: 0 };

  function escape(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function provenance(p) {
    var attested = p.attestationUrl
      ? '<a class="underline" href="' + escape(p.attestationUrl) + '" rel="noreferrer noopener" target="_blank">attestation</a>'
      : '<span class="text-ink-muted">not yet attested onchain</span>';
    return (
      '<div class="mt-2 bg-paper-alt px-3 py-2 text-xs">' +
      '<div>' + escape(p.protocol) + ' v' + escape(p.protocolVersion) +
      ' &middot; fetched ' + escape(p.fetchedAt) + '</div>' +
      '<div class="break-all">contentHash ' + escape(p.contentHash) + '</div>' +
      '<div>' + attested + '</div>' +
      '</div>'
    );
  }

  function render(items) {
    results.innerHTML = items
      .map(function (r) {
        return (
          '<article class="mb-8">' +
          '<h3 class="font-bold">' +
          '<a class="underline" href="' + escape(r.url) + '" rel="noreferrer noopener" target="_blank">' +
          escape(r.title || r.url) + '</a></h3>' +
          '<div class="text-sm text-ink-muted break-all">' + escape(r.url) +
          ' &middot; score ' + r.score.toFixed(4) + '</div>' +
          '<p class="mt-1">' + escape(r.snippet) + '</p>' +
          provenance(r.provenance) +
          '</article>'
        );
      })
      .join('');
  }

  function clear(message) {
    pager.hidden = true;
    results.innerHTML = '';
    status.textContent = message;
  }

  function run() {
    status.textContent = 'Searching...';
    var started = Date.now();

    return fetch('/api/web-search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: current.query, topK: PAGE, offset: current.offset }),
    })
      .then(function (response) {
        return response.json().then(function (parsed) {
          return { status: response.status, body: parsed };
        });
      })
      .then(function (out) {
        var elapsed = Date.now() - started;

        if (out.status === 429) {
          clear('That is a lot of searching. Try again in a moment.');
          return;
        }
        if (out.status === 404) {
          // The site was built with the box on against an API that has the
          // free route off. Say which, rather than looking broken.
          clear('Free search is not enabled on this endpoint.');
          return;
        }
        if (out.status !== 200) {
          clear('Error ' + out.status + ': ' + (out.body.error || 'request failed'));
          return;
        }

        var items = out.body.results || [];
        var offset = out.body.offset || 0;
        // `total` is a floor when the arms were cut off at the retrieval
        // ceiling, so say "or more" rather than claim a count we do not have.
        var total = out.body.total || 0;
        var more = out.body.exhaustive === false ? '+' : '';

        if (items.length === 0) {
          clear(offset > 0 ? 'No further results' : 'No results');
          return;
        }

        status.textContent =
          'Showing ' + (offset + 1) + '-' + (offset + items.length) +
          ' of ' + total + more + ' in ' + elapsed + ' ms';
        render(items);

        prev.disabled = offset === 0;
        next.disabled = !out.body.hasMore;
        pageOf.textContent = 'Page ' + (Math.floor(offset / PAGE) + 1);
        pager.hidden = false;
        if (offset > 0) results.scrollIntoView({ behavior: 'smooth', block: 'start' });
      })
      .catch(function (error) {
        clear('Request failed: ' + error.message);
      });
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var query = input.value.trim();
    if (!query) return;

    // A new query always starts at the first page.
    current = { query: query, offset: 0 };
    results.innerHTML = '';
    pager.hidden = true;
    run();
  });

  prev.addEventListener('click', function () {
    if (current.offset === 0) return;
    current.offset = Math.max(0, current.offset - PAGE);
    run();
  });

  next.addEventListener('click', function () {
    current.offset = current.offset + PAGE;
    run();
  });
})();
