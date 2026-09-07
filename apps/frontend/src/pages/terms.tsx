import { h } from '@wuzzy/static-site';
import { Layout } from '../layout';
import { site } from '../site.config';

/**
 * Carried over from the legacy wuzzy.io, with the passages describing the
 * deprecated architecture removed and nothing written to replace them.
 *
 * What came out: the Arweave/multi-modal description of the service, connected
 * Arweave wallets, content uploaded to Arweave, the Arweave-specific
 * disclaimers about permanence and blockchain risk, the analytics rate limit,
 * and the third-party section naming Arweave, Goldsky and wallet providers.
 * The protective clauses that were never architecture-specific stay: no
 * content hosting, delisting on a valid notice, no warranty, liability limits,
 * indemnity, governing law. Sections left empty by those removals are gone and
 * the remainder is renumbered. A full legal refresh is a separate job.
 */
export default () => (
  <Layout title="Terms of Service | Wuzzy">
    <article class="legal">
      <h1 class="mt-6 mb-6 text-2xl font-bold">Terms of Service</h1>

      <p class="text-ink-muted">
        <strong>Effective Date:</strong> November 15, 2025
        <br />
        <strong>Last Updated:</strong> November 15, 2025
      </p>

      <h2>1. Acceptance of Terms</h2>
      <p>
        Welcome to Wuzzy! By accessing or using our search platform ("Service"), you agree to be
        bound by these Terms of Service ("Terms"). If you do not agree to these Terms, please do
        not use the Service.
      </p>

      <h2>2. Description of Service</h2>
      <p>Wuzzy is a search platform that enables users to search and discover content.</p>

      <h2>3. User Responsibilities</h2>

      <h3>3.1 Acceptable Use</h3>
      <p>You agree to use the Service only for lawful purposes. You must not:</p>
      <ul>
        <li>Attempt to gain unauthorized access to our systems or networks</li>
        <li>Use the Service to search for or distribute illegal content</li>
        <li>Interfere with or disrupt the Service or servers</li>
        <li>Use automated tools (bots, scrapers) to abuse rate limits or overload the Service</li>
        <li>Violate any applicable local, national, or international law</li>
        <li>Infringe upon intellectual property rights of others</li>
      </ul>

      <h3>3.2 Rate Limiting</h3>
      <p>
        To ensure fair usage and service availability, we implement rate limiting. Excessive
        requests may result in temporary or permanent access restrictions. Current limits:
      </p>
      <ul>
        <li>Search requests: Subject to API rate limits</li>
      </ul>

      <h2>4. Intellectual Property</h2>

      <h3>4.1 Our Content</h3>
      <p>
        The Wuzzy platform, including its design, code, and branding, is open-source software
        licensed under the{' '}
        <a
          href="https://www.gnu.org/licenses/agpl-3.0.en.html"
          target="_blank"
          rel="noopener noreferrer"
        >
          GNU Affero General Public License v3.0 (AGPL-3.0)
        </a>
        . You may use, modify, and distribute the code in accordance with the license terms.
      </p>

      <h3>4.2 Search Results</h3>
      <p>
        We do not claim ownership of content indexed or displayed in search results.
      </p>

      <h2>5. Privacy and Data Protection</h2>
      <p>
        Your privacy is important to us. Please review our <a href="/privacy">Privacy Policy</a> to
        understand how we collect, use, and protect your information. Key points:
      </p>
      <ul>
        <li>No cookies or cross-site tracking</li>
        <li>Session data stored in your browser only</li>
        <li>IP addresses are anonymized for rate limiting</li>
      </ul>

      <h2>6. Disclaimers and Limitations of Liability</h2>

      <h3>6.1 "As-Is" Service</h3>
      <p>
        The Service is provided "as is" and "as available" without warranties of any kind, either
        express or implied, including but not limited to:
      </p>
      <ul>
        <li>Merchantability</li>
        <li>Fitness for a particular purpose</li>
        <li>Non-infringement</li>
        <li>Accuracy or completeness of search results</li>
        <li>Uninterrupted or error-free operation</li>
      </ul>

      <h3>6.2 No Guarantee of Accuracy</h3>
      <p>
        We do not guarantee the accuracy, completeness, or legality of indexed content. Users are
        responsible for verifying information independently.
      </p>

      <h3>6.3 Limitation of Liability</h3>
      <p>
        To the maximum extent permitted by law, Wuzzy and its contributors shall not be liable for:
      </p>
      <ul>
        <li>Indirect, incidental, special, consequential, or punitive damages</li>
        <li>Loss of profits, data, or goodwill</li>
        <li>Service interruptions or errors</li>
        <li>Damages arising from use or inability to use the Service</li>
        <li>Content accessed through search results</li>
      </ul>

      <h2>7. Indemnification</h2>
      <p>
        You agree to indemnify, defend, and hold harmless Wuzzy, its contributors, and affiliates
        from any claims, damages, losses, or expenses (including legal fees) arising from:
      </p>
      <ul>
        <li>Your use of the Service</li>
        <li>Your violation of these Terms</li>
        <li>Your violation of any third-party rights</li>
      </ul>

      <h2>8. Content Moderation and Illegal Content</h2>

      <h3>8.1 No Content Hosting</h3>
      <p>Wuzzy does not host content. We index and search content.</p>

      <h3>8.2 Reporting Illegal Content</h3>
      <p>If you discover illegal content in search results:</p>
      <ul>
        <li>We may delist specific results from our index if legally required</li>
        <li>
          Report concerns to: <a href={`mailto:${site.legalEmail}`}>{site.legalEmail}</a>
        </li>
      </ul>

      <h3>8.3 DMCA and Copyright</h3>
      <p>For copyright infringement claims under the Digital Millennium Copyright Act (DMCA):</p>
      <ul>
        <li>We may delist infringing content from our index upon valid DMCA notice</li>
        <li>
          Submit DMCA notices to: <a href={`mailto:${site.dmcaEmail}`}>{site.dmcaEmail}</a>
        </li>
      </ul>

      <h2>9. Modifications to the Service</h2>
      <p>We reserve the right to:</p>
      <ul>
        <li>Modify or discontinue the Service (or any feature) at any time</li>
        <li>Update these Terms with reasonable notice</li>
        <li>Change rate limits or access policies</li>
        <li>Implement new features or remove existing ones</li>
      </ul>
      <p>
        Significant changes will be announced on the platform or via our GitHub repository.
      </p>

      <h2>10. Termination</h2>
      <p>We may suspend or terminate your access to the Service at our discretion if you:</p>
      <ul>
        <li>Violate these Terms</li>
        <li>Abuse rate limits or engage in malicious activity</li>
        <li>Engage in illegal activity</li>
      </ul>
      <p>
        You may stop using the Service at any time. Upon termination, provisions regarding
        disclaimers, limitations of liability, and indemnification shall survive.
      </p>

      <h2>11. Governing Law and Dispute Resolution</h2>

      <h3>11.1 Governing Law</h3>
      <p>
        These Terms are governed by the laws of the State of Wyoming, United States, without regard
        to conflict of law principles.
      </p>

      <h3>11.2 Dispute Resolution</h3>
      <p>Any disputes arising from these Terms or the Service shall be resolved through:</p>
      <ol>
        <li>Good-faith negotiation between the parties</li>
        <li>Mediation, if negotiation fails</li>
        <li>Binding arbitration or litigation in the State of Wyoming, United States</li>
      </ol>

      <h3>11.3 Class Action Waiver</h3>
      <p>
        You agree to resolve disputes on an individual basis and waive any right to participate in
        class actions or collective proceedings.
      </p>

      <h2>12. Open Source and Contributions</h2>
      <p>Wuzzy is an open-source project. By contributing code, documentation, or feedback:</p>
      <ul>
        <li>You grant us a perpetual, royalty-free license to use your contributions</li>
        <li>You represent that your contributions do not infringe third-party rights</li>
        <li>Contributions are subject to the project's open-source license</li>
      </ul>
      <p>View our repositories:</p>
      <ul>
        <li>
          <a href={site.repo} target="_blank" rel="noopener noreferrer">
            Wuzzy Repository
          </a>
        </li>
        <li>
          <a href="https://github.com/Memetic-Block" target="_blank" rel="noopener noreferrer">
            Memetic Block GitHub
          </a>
        </li>
      </ul>

      <h2>13. Miscellaneous</h2>

      <h3>13.1 Entire Agreement</h3>
      <p>
        These Terms, together with our Privacy Policy, constitute the entire agreement between you
        and Wuzzy regarding the Service.
      </p>

      <h3>13.2 Severability</h3>
      <p>
        If any provision of these Terms is found invalid or unenforceable, the remaining provisions
        shall remain in full effect.
      </p>

      <h3>13.3 No Waiver</h3>
      <p>
        Our failure to enforce any right or provision of these Terms does not constitute a waiver
        of such right or provision.
      </p>

      <h3>13.4 Assignment</h3>
      <p>
        You may not assign or transfer these Terms without our prior written consent. We may assign
        our rights and obligations without restriction.
      </p>

      <h2>14. Contact Information</h2>
      <p>For questions, concerns, or notices regarding these Terms:</p>
      <ul>
        <li>
          <strong>GitHub Issues:</strong>{' '}
          <a href={`${site.repo}/issues`} target="_blank" rel="noopener noreferrer">
            Open an issue
          </a>
        </li>
        <li>
          <strong>Email:</strong> <a href={`mailto:${site.legalEmail}`}>{site.legalEmail}</a>
        </li>
        <li>
          <strong>DMCA Notices:</strong>{' '}
          <a href={`mailto:${site.dmcaEmail}`}>{site.dmcaEmail}</a>
        </li>
      </ul>

      <hr class="rule-double my-10 border-0" />

      <p class="text-ink-muted text-sm">
        By using Wuzzy, you acknowledge that you have read, understood, and agree to be bound by
        these Terms of Service and our Privacy Policy.
      </p>

      <p class="mt-8 flex gap-4">
        <a href="/" class="border-ink border-2 px-3 py-1 no-underline">
          Back to Home
        </a>
        <a href="/privacy" class="border-ink border-2 px-3 py-1 no-underline">
          Privacy Policy
        </a>
      </p>
    </article>
  </Layout>
);
