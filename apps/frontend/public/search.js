// The free human search box, as a bounded demonstration.
//
// Deliberately not a search engine: five results, no paging, and a line saying
// where the rest live. The paid /search contract is untouched by anything here;
// this posts to /web-search, which is unmetered and rate-limited by IP.
//
// Plain fetch rather than a framework: the route answers the same JSON a paying
// agent gets, so this page needs no second, HTML-shaped endpoint beside it. The
// receipt line on each result is the reason the box exists at all.
(function () {
  var form = document.getElementById('search-form');
  var input = document.getElementById('query');
  var caption = document.getElementById('results-caption');
  var results = document.getElementById('results');
  var more = document.getElementById('results-more');

  if (!form) return;

  // Rendered by the build. Relative behind the site's own nginx, absolute when
  // the site is served statically and the API is on another origin.
  var ENDPOINT = form.getAttribute('data-endpoint') || '/api/web-search';

  // Two on arrival, five for a real search. The cap is the demonstration's
  // shape, not a page size: there is nothing to page to.
  var SAMPLE_COUNT = 2;
  var RESULT_COUNT = 5;

  function escape(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // A receipt is only useful if it is checkable, so the hash is shown in a form
  // a reader can compare against an attestation rather than merely admire.
  function shortHash(hash) {
    var hex = String(hash || '').replace(/^0x/, '');
    return hex ? '0x…' + hex.slice(-4) : 'unknown';
  }

  function shortDate(value) {
    var text = String(value || '');
    return text.length >= 10 ? text.slice(0, 10) : text;
  }

  function receipt(p) {
    var parts = [];
    parts.push(
      p.attestationUid
        ? 'attested ✓'
        : '<span class="text-ink-muted">not yet attested</span>',
    );
    parts.push('sha256 ' + escape(shortHash(p.contentHash)));
    parts.push('fetched ' + escape(shortDate(p.fetchedAt)));
    if (p.attestationUrl) {
      parts.push(
        '<a class="underline" href="' +
          escape(p.attestationUrl) +
          '" rel="noreferrer noopener" target="_blank">view attestation</a>',
      );
    }
    return '<p class="text-ink-muted mt-1 font-mono text-xs">' + parts.join(' · ') + '</p>';
  }

  // A dense record, not a card: title, one line of context, one line of proof.
  function render(items) {
    results.innerHTML = items
      .map(function (r) {
        return (
          '<article class="border-ink/20 mb-4 border-b pb-4 last:border-0">' +
          '<h3 class="font-bold"><a class="underline" href="' +
          escape(r.url) +
          '" rel="noreferrer noopener" target="_blank">' +
          escape(r.title || r.url) +
          '</a></h3>' +
          '<p class="mt-1 truncate text-sm">' +
          escape(r.snippet) +
          '</p>' +
          receipt(r.provenance) +
          '</article>'
        );
      })
      .join('');
  }

  function say(html) {
    results.innerHTML = '<p class="text-sm leading-relaxed">' + html + '</p>';
    more.hidden = true;
  }

  function run(query, isSample) {
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
          if (isSample) return say('');
          if (out.status === 429) {
            return say(
              'The free window is rate-limited for humans. Agents query without limits ' +
                'through the <a class="underline" href="#quickstart">metered API</a>.',
            );
          }
          if (out.status === 404) {
            return say('Free search is not enabled on this endpoint.');
          }
          return say('Error ' + out.status + ': ' + escape(out.body.error || 'request failed'));
        }

        var items = out.body.results || [];
        caption.textContent = isSample
          ? 'Sample results — captured from the live API'
          : 'Results for "' + query + '" — index #1';

        if (items.length === 0) {
          if (isSample) return say('');
          return say(
            'No results in index #1 for that — it covers the Base ecosystem’s docs. ' +
              'Want other sources searchable? ' +
              '<a class="underline" href="' +
              escape(form.getAttribute('data-commission') || '#') +
              '">Commission an index.</a>',
          );
        }

        render(items);

        // `total` is a floor when the arms were cut off at the retrieval
        // ceiling, so say "or more" rather than claim a count we do not have.
        var total = out.body.total || items.length;
        var floor = out.body.exhaustive === false ? '+' : '';
        if (total > items.length) {
          more.innerHTML =
            'Top ' +
            items.length +
            ' of ' +
            total +
            floor +
            ' — agents get full results through the ' +
            '<a class="underline" href="#quickstart">metered API</a>';
          more.hidden = false;
        } else {
          more.hidden = true;
        }
      })
      .catch(function () {
        if (!isSample) say('Request failed. Try again in a moment.');
        else say('');
      });
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var query = input.value.trim();
    if (!query) return;
    run(query, false);
  });

  // One sample on arrival, so the case shows what a result looks like, receipt
  // included, before anyone types.
  var samples = (form.getAttribute('data-samples') || '').split('|').filter(Boolean);
  if (samples.length) {
    run(samples[Math.floor(Math.random() * samples.length)], true);
  }
})();
