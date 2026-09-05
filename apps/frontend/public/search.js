// Renders /search results, including the provenance block that is the point of
// the whole exercise. Plain fetch rather than htmx: the API answers JSON, which
// is the same contract a paying agent gets, and this page should not need a
// second, HTML-shaped endpoint to exist alongside it.
(function () {
  var form = document.getElementById('search-form');
  var input = document.getElementById('query');
  var picker = document.getElementById('index');
  var status = document.getElementById('status');
  var results = document.getElementById('results');
  var pager = document.getElementById('pager');
  var prev = document.getElementById('prev');
  var next = document.getElementById('next');
  var pageOf = document.getElementById('page-of');

  var PAGE = 10;
  // The query a page belongs to, so a stale response cannot repaint the
  // results of a newer one, and so paging pages what is on screen.
  var current = { query: '', index: '', offset: 0 };

  function escape(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function provenance(p) {
    var attested = p.attestationUrl
      ? '<a class="underline" href="' + escape(p.attestationUrl) + '" rel="noreferrer noopener" target="_blank">attestation</a>'
      : '<span class="text-gray-500">not yet attested onchain</span>';
    return (
      '<div class="mt-2 rounded bg-gray-50 px-3 py-2 font-mono text-xs text-gray-700">' +
      '<div>' + escape(p.protocol) + ' v' + escape(p.protocolVersion) +
      ' &middot; fetched ' + escape(p.fetchedAt) + '</div>' +
      '<div class="break-all">contentHash ' + escape(p.contentHash) + '</div>' +
      '<div>' + attested + '</div>' +
      '</div>'
    );
  }

  function render(items) {
    if (!items.length) {
      results.innerHTML = '<p class="text-gray-600">No results.</p>';
      return;
    }
    results.innerHTML = items
      .map(function (r) {
        return (
          '<article class="mb-8">' +
          '<h2 class="text-lg font-semibold">' +
          '<a class="underline" href="' + escape(r.url) + '" rel="noreferrer noopener" target="_blank">' +
          escape(r.title || r.url) + '</a></h2>' +
          '<div class="text-sm text-gray-500">' + escape(r.url) +
          ' &middot; score ' + r.score.toFixed(4) + '</div>' +
          '<p class="mt-1">' + escape(r.snippet) + '</p>' +
          provenance(r.provenance) +
          '</article>'
        );
      })
      .join('');
  }

  // The catalog lists the indexes the operator publishes. Unlisted ones are
  // absent from it, so there is nothing here to reveal that they exist.
  fetch('/api/indexes')
    .then(function (response) {
      return response.ok ? response.json() : { indexes: [] };
    })
    .then(function (body) {
      var catalog = body.indexes || [];
      if (catalog.length < 2) return;

      picker.innerHTML = catalog
        .map(function (index) {
          return '<option value="' + escape(index.slug) + '">' + escape(index.name) + '</option>';
        })
        .join('');
      picker.hidden = false;
    })
    .catch(function () {
      // A missing catalog is not a reason to break search: the field stays
      // hidden and every query goes to the global index, as before.
    });

  function run() {
    status.textContent = 'Searching...';
    var started = Date.now();
    var body = { query: current.query, topK: PAGE, offset: current.offset };
    if (current.index) body.index = current.index;
    var asked = JSON.stringify(body);

    return fetch('/api/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: asked,
    })
      .then(function (response) {
        return response.json().then(function (parsed) {
          return { status: response.status, body: parsed };
        });
      })
      .then(function (out) {
        var elapsed = Date.now() - started;
        if (out.status === 402) {
          // The meter is on. A browser cannot sign an x402 payment, so say so
          // plainly rather than pretending the index is empty.
          hidePager();
          results.innerHTML = '';
          status.innerHTML =
            'This endpoint is metered. Payment is the only gate, and a browser cannot sign one - ' +
            'use the demo agent: <code>bun run demo search "' + escape(current.query) + '"</code>';
          return;
        }
        if (out.status !== 200) {
          hidePager();
          results.innerHTML = '';
          status.textContent = 'Error ' + out.status + ': ' + (out.body.error || 'request failed');
          return;
        }

        var items = out.body.results || [];
        var offset = out.body.offset || 0;
        // `total` is a floor when the arms were cut off at the retrieval
        // ceiling, so say "or more" rather than claim a count we do not have.
        var total = out.body.total || 0;
        var more = out.body.exhaustive === false ? '+' : '';

        if (items.length === 0) {
          hidePager();
          results.innerHTML = '';
          status.textContent = offset > 0 ? 'No further results' : 'No results';
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
        hidePager();
        status.textContent = 'Request failed: ' + error.message;
      });
  }

  function hidePager() {
    pager.hidden = true;
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var query = input.value.trim();
    if (!query) return;

    // A new query always starts at the first page.
    current = { query: query, index: picker.hidden ? '' : picker.value, offset: 0 };
    results.innerHTML = '';
    hidePager();
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
