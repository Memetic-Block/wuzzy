// Read-only admin view over the store. Everything here is a GET; the admin API
// never writes, so a mistake in this file cannot corrupt the corpus.
//
// One script for every page. There is no bundler, so splitting it per page
// would mean copying the helpers into each copy; instead each page's setup runs
// only when the elements it needs are actually present.
(function () {
  var params = new URLSearchParams(location.search);
  var token = params.get('token') || '';

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function el(id) { return document.getElementById(id); }
  function short(hash) { return hash ? esc(hash).slice(0, 12) + '…' : '-'; }
  function when(iso) { return iso ? esc(new Date(iso).toLocaleString()) : '-'; }

  // Every internal link carries the token forward. Losing it on navigation
  // would log the operator out halfway through a task, on a tool whose whole
  // job is following one thread from a number to the row behind it.
  function link(path, extra) {
    var q = new URLSearchParams(extra || {});
    if (token) q.set('token', token);
    var query = q.toString();
    return query ? path + '?' + query : path;
  }

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
    if (!box) return;
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

  function table(head, rows) {
    if (!rows.length) return '<p class="text-gray-600">Nothing to show.</p>';
    return (
      '<table class="w-full text-left text-sm"><thead><tr class="border-b border-gray-300">' +
      head.map(function (h) { return '<th class="py-1">' + esc(h) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + rows.join('') + '</tbody></table>'
    );
  }

  // --- Overview -------------------------------------------------------------

  function overview() {
    return api('/stats').then(function (s) {
      var pct = s.documents ? Math.round((s.attested / s.documents) * 100) : 0;
      el('stats').innerHTML =
        tile('Documents', s.documents) +
        tile('Chunks', s.chunks) +
        tile('Fetches', s.fetches, s.skipped + ' skipped, ' + s.failed + ' failed') +
        tile('Embedded', s.embedded + '/' + s.documents) +
        tile('Attested', s.attested + '/' + s.documents, pct + '% onchain') +
        tile('Unindexed', s.unindexed, 'kept for provenance, out of search') +
        tile('Protocols', s.protocols[0]
          ? s.protocols[0].protocol + ' v' + s.protocols[0].protocolVersion : '-') +
        tile('First fetch', s.firstFetchedAt
          ? new Date(s.firstFetchedAt).toLocaleDateString() : '-') +
        tile('Last fetch', s.lastFetchedAt
          ? new Date(s.lastFetchedAt).toLocaleDateString() : '-');

      el('hosts').innerHTML = table(['Host', 'Documents'], s.hosts.map(function (h) {
        return '<tr class="border-b border-gray-100"><td class="py-1">' +
          '<a class="underline" href="' + link('/documents', { q: h.host }) + '">' +
          esc(h.host) + '</a></td>' +
          '<td class="py-1 text-right">' + h.documents + '</td></tr>';
      }));
    });
  }

  // --- Indexes --------------------------------------------------------------

  function indexesPage() {
    return api('/indexes').then(function (rows) {
      el('index-count').textContent = rows.length + (rows.length === 1 ? ' index' : ' indexes');

      el('indexes').innerHTML = table(
        ['Index', 'Owner', 'Access', 'Status', 'Pages', 'Attested', 'Pending', 'Created'],
        rows.map(function (i) {
          var access = i.visibility + ' / ' + i.readPolicy +
            (i.readPolicy === 'allowlist' ? ' (' + i.readers + ')' : '');
          return '<tr class="border-b border-gray-100 hover:bg-gray-50">' +
            '<td class="py-1"><a class="underline" href="' +
            link('/documents', { index: i.slug }) + '">' + esc(i.name) + '</a>' +
            '<div class="text-xs text-gray-500">' + esc(i.slug) + '</div></td>' +
            '<td class="py-1 font-mono text-xs">' + short(i.owner) + '</td>' +
            '<td class="py-1 text-xs">' + esc(access) + '</td>' +
            '<td class="py-1 text-xs">' + esc(i.status) + '</td>' +
            '<td class="py-1 text-right">' + i.pages +
            (i.pageCap === null ? '' :
              '<span class="text-xs text-gray-500">/' + i.pageCap + '</span>') + '</td>' +
            '<td class="py-1 text-right">' + i.attested + '</td>' +
            '<td class="py-1 text-right">' + i.pending + '</td>' +
            '<td class="py-1 text-xs">' + when(i.createdAt) + '</td></tr>';
        }),
      );
    });
  }

  // --- Documents ------------------------------------------------------------

  function documentsPage() {
    // Opening state comes from the URL, so a filtered list is a link an
    // operator can share or come back to.
    var state = {
      offset: Number(params.get('offset') || 0),
      limit: 25,
      q: params.get('q') || '',
      filter: params.get('filter') || 'all',
      index: params.get('index') || '',
    };
    el('doc-q').value = state.q;
    el('doc-filter').value = state.filter;

    function load() {
      var qs = '?limit=' + state.limit + '&offset=' + state.offset +
        '&filter=' + encodeURIComponent(state.filter) +
        (state.index ? '&index=' + encodeURIComponent(state.index) : '') +
        (state.q ? '&q=' + encodeURIComponent(state.q) : '');

      return api('/documents' + qs).then(function (page) {
        el('doc-count').textContent = page.total + ' total, showing ' +
          (page.total ? page.offset + 1 : 0) + '-' +
          Math.min(page.offset + page.limit, page.total);

        el('documents').innerHTML = table(
          ['Title', 'contentHash', 'Chunks', 'Embedded', 'Attested', 'Fetched'],
          page.documents.map(function (d) {
            return '<tr class="border-b border-gray-100 hover:bg-gray-50">' +
              '<td class="py-1"><a class="underline" href="' +
              link('/document', { id: d.id }) + '">' + esc(d.title || '(untitled)') + '</a>' +
              '<div class="text-xs text-gray-500">' + esc(d.url) + '</div></td>' +
              '<td class="py-1 font-mono text-xs">' + short(d.contentHash) + '</td>' +
              '<td class="py-1">' + d.chunks + '</td>' +
              '<td class="py-1">' + (d.embedded ? 'yes' : 'no') + '</td>' +
              '<td class="py-1">' + (d.attestationUid ? 'yes' : 'no') + '</td>' +
              '<td class="py-1 text-xs">' + when(d.fetchedAt) + '</td></tr>';
          }),
        );

        el('prev').disabled = state.offset === 0;
        el('next').disabled = state.offset + state.limit >= page.total;
        // Keep the address bar in step so a reload lands on the same view.
        history.replaceState(null, '', link('/documents', {
          q: state.q, index: state.index, filter: state.filter, offset: state.offset,
        }));
      });
    }

    api('/indexes').then(function (rows) {
      el('doc-index').innerHTML = '<option value="">every index</option>' +
        rows.map(function (i) {
          return '<option value="' + esc(i.slug) + '">' + esc(i.name) + '</option>';
        }).join('');
      el('doc-index').value = state.index;
    }).catch(fail);

    var timer;
    el('doc-q').addEventListener('input', function (e) {
      clearTimeout(timer);
      timer = setTimeout(function () {
        state.q = e.target.value.trim();
        state.offset = 0;
        load().catch(fail);
      }, 250);
    });
    el('doc-filter').addEventListener('change', function (e) {
      state.filter = e.target.value; state.offset = 0; load().catch(fail);
    });
    el('doc-index').addEventListener('change', function (e) {
      state.index = e.target.value; state.offset = 0; load().catch(fail);
    });
    el('prev').addEventListener('click', function () {
      state.offset = Math.max(0, state.offset - state.limit); load().catch(fail);
    });
    el('next').addEventListener('click', function () {
      state.offset = state.offset + state.limit; load().catch(fail);
    });

    return load();
  }

  // --- One document ---------------------------------------------------------

  function documentPage() {
    var id = params.get('id');
    if (!id) {
      el('detail').innerHTML = '<p class="text-gray-600">No document id in the URL.</p>';
      return Promise.resolve();
    }

    return api('/documents/' + encodeURIComponent(id)).then(function (d) {
      el('detail').innerHTML =
        '<h1 class="text-2xl font-bold">' + esc(d.title || d.url) + '</h1>' +
        '<div class="text-sm text-gray-500">' +
        '<a class="underline" target="_blank" rel="noreferrer noopener" href="' +
        esc(d.url) + '">' + esc(d.url) + '</a></div>' +
        '<div class="mt-3 rounded bg-gray-50 px-3 py-2 font-mono text-xs">' +
        '<div>protocol ' + esc(d.protocol) + ' v' + esc(d.protocolVersion) + '</div>' +
        '<div class="break-all">contentHash ' + esc(d.contentHash) + '</div>' +
        '<div class="break-all">rawHash     ' + esc(d.rawHash) + '</div>' +
        '<div>robots ' + esc(d.robotsStatus) + ' &middot; HTTP ' + esc(d.httpStatus) +
        ' &middot; ' + esc(d.contentChars) + ' chars</div>' +
        '<div>embedded ' + when(d.embeddedAt) + ' &middot; attested ' + when(d.attestedAt) + '</div>' +
        (d.attestationUrl ? '<div><a class="underline" target="_blank" rel="noreferrer noopener" ' +
          'href="' + esc(d.attestationUrl) + '">attestation</a></div>' : '') +
        '</div>' +
        '<h2 class="mt-6 text-lg font-semibold">Fetch history (' + d.fetches.length + ')</h2>' +
        table(['When', 'Status', 'contentHash', 'Outcome'], d.fetches.map(function (f) {
          var outcome = f.error ? 'error: ' + esc(f.error)
            : f.skipped_reason ? 'skipped: ' + esc(f.skipped_reason)
            : f.content_changed ? 'changed' : 'unchanged';
          return '<tr class="border-b border-gray-100"><td class="py-1 text-xs">' +
            when(f.fetched_at) + '</td><td class="py-1 text-xs">' +
            (f.http_status === null ? 'no response' : 'HTTP ' + esc(f.http_status)) + '</td>' +
            '<td class="py-1 font-mono text-xs">' + short(f.content_hash) + '</td>' +
            '<td class="py-1 text-xs">' + outcome + '</td></tr>';
        })) +
        '<h2 class="mt-6 text-lg font-semibold">Chunks (' + d.chunkList.length + ')</h2>' +
        d.chunkList.map(function (c) {
          return '<div class="mt-2 border-l-2 border-gray-200 pl-3 text-sm">' +
            '<div class="text-xs text-gray-500">#' + c.ordinal + ' &middot; ~' +
            esc(c.token_count) + ' tokens &middot; ' +
            (c.embedded ? 'embedded' : 'not embedded') + '</div>' +
            esc(c.preview) + '…</div>';
        }).join('');
    });
  }

  // --- Activity -------------------------------------------------------------

  function activityPage() {
    var state = { filter: params.get('filter') || 'all', limit: params.get('limit') || '50' };
    el('act-filter').value = state.filter;
    el('act-limit').value = state.limit;

    function load() {
      return api('/activity?limit=' + state.limit + '&filter=' + encodeURIComponent(state.filter))
        .then(function (rows) {
          el('activity').innerHTML = table(
            ['When', 'URL', 'Status', 'Outcome'],
            rows.map(function (r) {
              var outcome = r.error ? '<span class="text-red-700">error: ' + esc(r.error) + '</span>'
                : r.skipped_reason ? 'skipped: ' + esc(r.skipped_reason)
                : r.content_changed ? 'content changed' : 'unchanged';
              var url = r.document_id
                ? '<a class="underline" href="' + link('/document', { id: r.document_id }) + '">' +
                  esc(r.url) + '</a>'
                : esc(r.url);
              return '<tr class="border-b border-gray-100"><td class="py-1 text-xs">' +
                when(r.fetched_at) + '</td><td class="py-1 break-all">' + url + '</td>' +
                '<td class="py-1 text-xs">' +
                (r.http_status === null ? 'no response' : 'HTTP ' + esc(r.http_status)) +
                '</td><td class="py-1 text-xs">' + outcome + '</td></tr>';
            }),
          );
          history.replaceState(null, '', link('/activity', state));
        });
    }

    el('act-filter').addEventListener('change', function (e) {
      state.filter = e.target.value; load().catch(fail);
    });
    el('act-limit').addEventListener('change', function (e) {
      state.limit = e.target.value; load().catch(fail);
    });
    return load();
  }

  // --- Boot -----------------------------------------------------------------

  Array.prototype.forEach.call(document.querySelectorAll('[data-nav]'), function (a) {
    a.setAttribute('href', link(a.getAttribute('href')));
  });

  var page =
    el('stats') ? overview() :
    el('indexes') ? indexesPage() :
    el('documents') ? documentsPage() :
    el('detail') ? documentPage() :
    el('activity') ? activityPage() :
    Promise.resolve();

  page.catch(fail);
})();
