// The free human search box, as a bounded demonstration.
//
// Deliberately not a search engine: five results, no paging, and a line saying
// where the rest live. The paid /search contract is untouched by anything here;
// this posts to /web-search, which is unmetered and rate-limited by IP.
//
// Everything it writes goes inside the ledger, which is the one scrolling
// region on the page. Nothing below the case moves when a search lands, which
// is the whole reason the case has a fixed height.
//
// Plain fetch rather than a framework: the route answers the same JSON a paying
// agent gets, so this page needs no second, HTML-shaped endpoint beside it. The
// receipt line on each result is the reason the box exists at all.
(function () {
  var form = document.getElementById('search-form');
  var input = document.getElementById('query');
  var caption = document.getElementById('ledger-caption');
  var ledger = document.getElementById('ledger');
  var refresh = document.getElementById('ledger-refresh');
  var badge = document.getElementById('ledger-live');

  if (!form || !input || !caption || !ledger) return;

  // Rendered by the build. Relative behind the site's own nginx, absolute when
  // the site is served statically and the API is on another origin.
  var ENDPOINT = form.getAttribute('data-endpoint') || '/api/web-search';
  var COMMISSION = form.getAttribute('data-commission') || '#commission';

  // Two on arrival, five for a real search. The cap is the demonstration's
  // shape, not a page size: there is nothing to page to.
  var SAMPLE_COUNT = 2;
  var RESULT_COUNT = 5;

  var CAPTIONS = {
    sample: 'SAMPLE RESULTS — CAPTURED FROM THE LIVE API',
    results: 'RESULTS · INDEX #1',
    empty: 'NO MATCHES · INDEX #1',
    limit: 'FREE WINDOW EXHAUSTED',
    // An index with nothing in it yet is not a search that found nothing, and
    // captioning it as a sample would advertise results that do not exist.
    commissioning: 'INDEX #1 · BEING COMMISSIONED',
  };

  var COMMISSIONING =
    "Index #1 is being commissioned — sample results publish when it's live.";

  function escape(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // A receipt is only useful if it is checkable, so the hash keeps both ends:
  // enough to compare against an attestation rather than merely admire.
  function shortHash(hash) {
    var hex = String(hash || '').replace(/^0x/, '');
    if (!hex) return 'unknown';
    return hex.length > 8 ? '0x' + hex.slice(0, 4) + '…' + hex.slice(-4) : '0x' + hex;
  }

  // UTC to the minute. A fetch time is evidence, so it is stated in the zone
  // the attestation records rather than in the reader's, which would differ
  // from the chain's for most of the world.
  function stamp(value) {
    var at = new Date(value);
    if (isNaN(at.getTime())) return 'unknown';
    return at.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  }

  // Rendered once by the page. Berkeley Mono has no check-mark glyph, so the
  // mark is drawn; taking it from the page rather than repeating it here keeps
  // one definition. Degrades to the word alone if the template is missing,
  // which says the same thing without a second copy of the drawing.
  var attestedMark = (function () {
    var template = document.getElementById('attested-mark');
    return template
      ? template.innerHTML
      : '<span class="text-accent font-medium">attested</span>';
  })();

  function receipt(p) {
    var provenance = p || {};
    var parts = [];
    parts.push(provenance.attestationUid ? attestedMark : '<span>not yet attested</span>');
    parts.push('<span>sha256 ' + escape(shortHash(provenance.contentHash)) + '</span>');
    parts.push('<span>fetched ' + escape(stamp(provenance.fetchedAt)) + '</span>');
    if (provenance.attestationUrl) {
      parts.push(
        '<a class="text-receipt" href="' +
          escape(provenance.attestationUrl) +
          '" rel="noreferrer noopener" target="_blank">view attestation</a>',
      );
    }
    return (
      '<div class="text-receipt text-ink-muted flex flex-wrap gap-x-[14px] gap-y-1">' +
      parts.join('') +
      '</div>'
    );
  }

  // A dense record, not a card: title, one line of context, one line of proof.
  function entry(r) {
    return (
      '<article class="border-rule-soft border-b p-[14px]">' +
      '<a class="text-result text-ink font-medium [text-decoration-color:var(--color-underline)]" href="' +
      escape(r.url) +
      '" rel="noreferrer noopener" target="_blank">' +
      escape(r.title || r.url) +
      '</a>' +
      '<p class="text-prose text-ink-body mt-[5px] mb-2 max-w-[78ch]" style="line-height:1.55">' +
      escape(r.snippet) +
      '</p>' +
      receipt(r.provenance) +
      '</article>'
    );
  }

  function notice(html) {
    return (
      '<div class="text-prose text-ink-body max-w-[70ch] px-[14px] py-4" style="line-height:1.6">' +
      html +
      '</div>'
    );
  }

  function tally(shown, total, floor) {
    return (
      '<div class="border-rule-strong text-sub text-ink-muted border-t border-dashed px-[14px] py-[11px]">' +
      'Top ' +
      shown +
      ' of ' +
      total +
      floor +
      ' — agents get full results through the ' +
      '<a href="' +
      escape(COMMISSION) +
      '">metered API</a>.' +
      '</div>'
    );
  }

  /**
   * Writes the ledger, and decides whether the case may call itself LIVE.
   *
   * `live` is passed only where real entries were rendered, so the badge and
   * the contents cannot disagree: there is no separate flag that could be left
   * true over an empty box.
   */
  function show(mode, html, live) {
    caption.textContent = CAPTIONS[mode];
    ledger.innerHTML = html;
    ledger.scrollTop = 0;
    if (badge) badge.hidden = !live;
  }

  /**
   * The query in the address bar, so a search can be linked to and survives a
   * reload. replaceState rather than pushState: the box is one control on a
   * page, and filling the reader's back button with their own typing would
   * make leaving the page take as many presses as they made searches.
   */
  function remember(query) {
    if (!window.history || !window.history.replaceState) return;
    var url = new URL(window.location.href);
    if (query) url.searchParams.set('q', query);
    else url.searchParams.delete('q');
    window.history.replaceState(null, '', url.toString());
  }

  // One request at a time. The refresh button is the only control that can
  // be pressed repeatedly without typing, so it is the only one that can race
  // its own results into the ledger out of order.
  var busy = false;

  // `isSample` says how to caption the ledger. `silent` says whether the
  // reader asked for this. They are not the same question: the opening sample
  // is ours and should not open by blaming anyone for its own failure, but
  // everything reachable from the refresh button was asked for, and an answer
  // is owed.
  function run(query, isSample, silent) {
    if (busy) return Promise.resolve();
    busy = true;
    if (refresh) refresh.disabled = true;

    var want = isSample ? SAMPLE_COUNT : RESULT_COUNT;

    return fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: query, topK: want, offset: 0 }),
    })
      .then(function (response) {
        return response.json().then(function (parsed) {
          return { status: response.status, body: parsed };
        });
      })
      .then(function (out) {
        // A sample nobody asked for must not report its own failure: an
        // unreachable or throttled API should leave a quiet empty case rather
        // than blame the reader for the site's opening move.
        if (out.status !== 200) {
          // A rate limit is a documented state of the free window with copy
          // written for it, not a breakage. Always say so, opening sample
          // included: a case that renders empty reads as a dead product, which
          // is a worse answer than the true one.
          if (out.status === 429) {
            return show(
              'limit',
              notice(
                'The free window is rate-limited for humans. Agents query without limits ' +
                  'through the <a href="' +
                  escape(COMMISSION) +
                  '">metered API</a>.',
              ),
            );
          }
          if (silent) return show('sample', '');
          if (out.status === 404) {
            return show('empty', notice('Free search is not enabled on this endpoint.'));
          }
          return show(
            'empty',
            notice('Error ' + out.status + ': ' + escape((out.body && out.body.error) || 'request failed')),
          );
        }

        var items = out.body.results || [];

        if (items.length === 0) {
          if (silent) return show('commissioning', notice(COMMISSIONING));
          return show(
            'empty',
            notice(
              'No results in index #1 for that — it covers the Base ecosystem’s docs. ' +
                'Want other sources searchable? ' +
                '<a href="' +
                escape(COMMISSION) +
                '">Commission an index.</a>',
            ),
          );
        }

        var html = items.map(entry).join('');

        // `total` is a floor when the arms were cut off at the retrieval
        // ceiling, so say "or more" rather than claim a count we do not have.
        var total = out.body.total || items.length;
        if (!isSample && total > items.length) {
          html += tally(items.length, total, out.body.exhaustive === false ? '+' : '');
        }

        show(isSample ? 'sample' : 'results', html, true);
      })
      .catch(function () {
        if (silent) return show('sample', '');
        show('empty', notice('Request failed. Try again in a moment.'));
      })
      .then(function () {
        busy = false;
        if (refresh) refresh.disabled = false;
      });
  }

  function search(query) {
    remember(query);
    run(query, false, false);
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var query = input.value.trim();
    if (!query) return;
    search(query);
  });

  var samples = (form.getAttribute('data-samples') || '').split('|').filter(Boolean);
  var showing = null;

  // Never the one already on screen: pressing refresh and getting the same two
  // rows back reads as a broken button rather than as a coincidence.
  function nextSample() {
    if (samples.length < 2) return samples[0] || null;
    var pick = showing;
    while (pick === showing) pick = samples[Math.floor(Math.random() * samples.length)];
    showing = pick;
    return pick;
  }

  // `auto` is the one on arrival, which nobody asked for. Every other route
  // into here is the refresh button, which somebody pressed.
  function sample(auto) {
    var query = nextSample();
    if (!query) return;
    // The address bar described a search that is no longer on screen.
    remember('');
    input.value = '';
    run(query, true, auto === true);
  }

  if (refresh && samples.length > 1) {
    refresh.hidden = false;
    refresh.addEventListener('click', function () {
      sample();
    });
  }

  // A linked query wins over the opening sample: someone arriving at ?q= asked
  // for that search, and showing them samples first would answer a question
  // nobody asked. Otherwise one sample, so the case shows what a result looks
  // like, receipt included, before anyone types.
  var linked = new URL(window.location.href).searchParams.get('q');
  if (linked && linked.trim()) {
    input.value = linked.trim();
    run(linked.trim(), false, false);
  } else {
    sample(true);
  }
})();
