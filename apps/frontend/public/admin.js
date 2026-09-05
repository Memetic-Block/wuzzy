// Read-only admin view over the global index. Everything here is a GET; the
// admin API never writes, so a mistake in this file cannot corrupt the corpus.
(function () {
  var state = { offset: 0, limit: 25, q: '', filter: 'all' };
  var token = new URLSearchParams(location.search).get('token') || '';

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function el(id) { return document.getElementById(id); }
  function short(hash) { return hash ? esc(hash).slice(0, 12) + '…' : '—'; }
  function when(iso) { return iso ? esc(new Date(iso).toLocaleString()) : '—'; }

  function api(path) {
    var headers = token ? { 'x-admin-token': token } : {};
    return fetch('/api/admin' + path, { headers: headers }).then(function (r) {
      if (r.status === 404) throw new Error('admin API is disabled (set ADMIN_ENABLED=true)');
      if (r.status === 401) throw new Error('admin token rejected: append ?token=... to the URL');
      if (!r.ok) throw new Error('admin API returned ' + r.status);
      return r.json();
    });
  }

  function fail(error) {
    var box = el('admin-error');
    box.textContent = error.message;
    box.classList.remove('hidden');
  }

  function tile(label, value, hint) {
    return (
      '<div class="rounded border border-gray-200 px-3 py-2">' +
      '<div class="text-xs uppercase tracking-wide text-gray-500">' + esc(label) + '</div>' +
      '<div class="text-xl font-semibold">' + esc(value) + '</div>' +
      (hint ? '<div class="text-xs text-gray-500">' + esc(hint) + '</div>' : '') +
      '</div>'
    );
  }

  function loadStats() {
    return api('/stats').then(function (s) {
      var pct = s.documents ? Math.round((s.attested / s.documents) * 100) : 0;
      el('stats').innerHTML =
        tile('Documents', s.documents) +
        tile('Chunks', s.chunks) +
        tile('Fetches', s.fetches, s.skipped + ' skipped, ' + s.failed + ' failed') +
        tile('Embedded', s.embedded + '/' + s.documents) +
        tile('Attested', s.attested + '/' + s.documents, pct + '% onchain') +
        tile('Protocols', (s.protocols[0] ? s.protocols[0].protocol + ' v' + s.protocols[0].protocolVersion : '—')) +
        tile('First fetch', s.firstFetchedAt ? new Date(s.firstFetchedAt).toLocaleDateString() : '—') +
        tile('Last fetch', s.lastFetchedAt ? new Date(s.lastFetchedAt).toLocaleDateString() : '—');

      el('hosts').innerHTML = s.hosts.length
        ? '<table class="w-full text-left"><tbody>' +
          s.hosts.map(function (h) {
            return '<tr class="border-b border-gray-100"><td class="py-1">' + esc(h.host) +
              '</td><td class="py-1 text-right">' + h.documents + '</td></tr>';
          }).join('') + '</tbody></table>'
        : '<p class="text-gray-600">Nothing indexed yet.</p>';
    });
  }

  function loadDocuments() {
    var qs = '?limit=' + state.limit + '&offset=' + state.offset +
      '&filter=' + encodeURIComponent(state.filter) +
      (state.q ? '&q=' + encodeURIComponent(state.q) : '');
    return api('/documents' + qs).then(function (page) {
      el('doc-count').textContent =
        page.total + ' total, showing ' + (page.total ? page.offset + 1 : 0) +
        '-' + Math.min(page.offset + page.limit, page.total);

      el('documents').innerHTML = page.documents.length
        ? '<table class="w-full text-left text-sm"><thead><tr class="border-b border-gray-300">' +
          '<th class="py-1">Title</th><th class="py-1">contentHash</th><th class="py-1">Chunks</th>' +
          '<th class="py-1">Embedded</th><th class="py-1">Attested</th><th class="py-1">Fetched</th></tr></thead><tbody>' +
          page.documents.map(function (d) {
            return '<tr class="cursor-pointer border-b border-gray-100 hover:bg-gray-50" data-id="' + esc(d.id) + '">' +
              '<td class="py-1"><div>' + esc(d.title || '(untitled)') + '</div>' +
              '<div class="text-xs text-gray-500">' + esc(d.url) + '</div></td>' +
              '<td class="py-1 font-mono text-xs">' + short(d.contentHash) + '</td>' +
              '<td class="py-1">' + d.chunks + '</td>' +
              '<td class="py-1">' + (d.embedded ? 'yes' : 'no') + '</td>' +
              '<td class="py-1">' + (d.attestationUid ? 'yes' : 'no') + '</td>' +
              '<td class="py-1 text-xs">' + when(d.fetchedAt) + '</td></tr>';
          }).join('') + '</tbody></table>'
        : '<p class="text-gray-600">No documents match.</p>';

      Array.prototype.forEach.call(el('documents').querySelectorAll('tr[data-id]'), function (row) {
        row.addEventListener('click', function () { loadDetail(row.getAttribute('data-id')); });
      });
    });
  }

  function loadActivity() {
    return api('/activity?limit=15').then(function (rows) {
      el('activity').innerHTML = rows.length
        ? '<table class="w-full text-left text-sm"><tbody>' + rows.map(function (r) {
            var note = r.error ? 'error: ' + esc(r.error)
              : r.skipped_reason ? 'skipped: ' + esc(r.skipped_reason)
              : r.content_changed ? 'content changed' : 'unchanged';
            return '<tr class="border-b border-gray-100"><td class="py-1 text-xs">' + when(r.fetched_at) +
              '</td><td class="py-1">' + esc(r.url) + '</td><td class="py-1 text-xs">HTTP ' +
              esc(r.http_status) + '</td><td class="py-1 text-xs text-gray-600">' + note + '</td></tr>';
          }).join('') + '</tbody></table>'
        : '<p class="text-gray-600">No fetches recorded.</p>';
    });
  }

  function loadDetail(id) {
    api('/documents/' + encodeURIComponent(id)).then(function (d) {
      el('detail').innerHTML =
        '<h2 class="text-lg font-semibold">' + esc(d.title || d.url) + '</h2>' +
        '<div class="text-sm text-gray-500">' + esc(d.url) + '</div>' +
        '<div class="mt-2 rounded bg-gray-50 px-3 py-2 font-mono text-xs">' +
        '<div>protocol ' + esc(d.protocol) + ' v' + esc(d.protocolVersion) + '</div>' +
        '<div class="break-all">contentHash ' + esc(d.contentHash) + '</div>' +
        '<div class="break-all">rawHash     ' + esc(d.rawHash) + '</div>' +
        '<div>robots ' + esc(d.robotsStatus) + ' &middot; HTTP ' + esc(d.httpStatus) +
        ' &middot; ' + esc(d.contentChars) + ' chars</div>' +
        '<div>embedded ' + when(d.embeddedAt) + ' &middot; attested ' + when(d.attestedAt) + '</div>' +
        (d.attestationUrl ? '<div><a class="underline" target="_blank" rel="noreferrer noopener" href="' +
          esc(d.attestationUrl) + '">attestation</a></div>' : '') +
        '</div>' +
        '<h3 class="mt-4 font-semibold">Fetch history (' + d.fetches.length + ')</h3>' +
        '<table class="mt-1 w-full text-left text-sm"><tbody>' + d.fetches.map(function (f) {
          return '<tr class="border-b border-gray-100"><td class="py-1 text-xs">' + when(f.fetched_at) +
            '</td><td class="py-1 text-xs">HTTP ' + esc(f.http_status) + '</td>' +
            '<td class="py-1 font-mono text-xs">' + short(f.content_hash) + '</td>' +
            '<td class="py-1 text-xs">' + (f.content_changed ? 'changed' : 'unchanged') + '</td></tr>';
        }).join('') + '</tbody></table>' +
        '<h3 class="mt-4 font-semibold">Chunks (' + d.chunkList.length + ')</h3>' +
        d.chunkList.map(function (c) {
          return '<div class="mt-2 border-l-2 border-gray-200 pl-3 text-sm">' +
            '<div class="text-xs text-gray-500">#' + c.ordinal + ' &middot; ~' +
            esc(c.token_count) + ' tokens &middot; ' + (c.embedded ? 'embedded' : 'not embedded') + '</div>' +
            esc(c.preview) + '…</div>';
        }).join('');
      el('detail').scrollIntoView({ behavior: 'smooth' });
    }).catch(fail);
  }

  var timer;
  el('doc-q').addEventListener('input', function (e) {
    clearTimeout(timer);
    timer = setTimeout(function () {
      state.q = e.target.value.trim();
      state.offset = 0;
      loadDocuments().catch(fail);
    }, 250);
  });
  el('doc-filter').addEventListener('change', function (e) {
    state.filter = e.target.value;
    state.offset = 0;
    loadDocuments().catch(fail);
  });
  el('prev').addEventListener('click', function () {
    state.offset = Math.max(0, state.offset - state.limit);
    loadDocuments().catch(fail);
  });
  el('next').addEventListener('click', function () {
    state.offset = state.offset + state.limit;
    loadDocuments().catch(fail);
  });

  Promise.all([loadStats(), loadDocuments(), loadActivity()]).catch(fail);
})();
