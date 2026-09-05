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

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var query = input.value.trim();
    if (!query) return;

    status.textContent = 'Searching...';
    results.innerHTML = '';
    var started = Date.now();

    fetch('/api/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        picker.hidden || !picker.value
          ? { query: query, topK: 10 }
          : { query: query, topK: 10, index: picker.value },
      ),
    })
      .then(function (response) {
        return response.json().then(function (body) {
          return { status: response.status, body: body };
        });
      })
      .then(function (out) {
        var elapsed = Date.now() - started;
        if (out.status === 402) {
          // The meter is on. A browser cannot sign an x402 payment, so say so
          // plainly rather than pretending the index is empty.
          status.innerHTML =
            'This endpoint is metered. Payment is the only gate, and a browser cannot sign one - ' +
            'use the demo agent: <code>bun run demo search "' + escape(query) + '"</code>';
          return;
        }
        if (out.status !== 200) {
          status.textContent = 'Error ' + out.status + ': ' + (out.body.error || 'request failed');
          return;
        }
        var items = out.body.results || [];
        status.textContent = items.length + ' result' + (items.length === 1 ? '' : 's') + ' in ' + elapsed + ' ms';
        render(items);
      })
      .catch(function (error) {
        status.textContent = 'Request failed: ' + error.message;
      });
  });
})();
