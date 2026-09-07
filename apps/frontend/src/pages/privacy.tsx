import { h } from '@wuzzy/static-site';
import { Layout } from '../layout';
import { site } from '../site.config';

/**
 * Carried over from the legacy wuzzy.io, with the passages describing data
 * practices that no longer exist removed and nothing written to replace them.
 *
 * What came out: the Arweave/multi-modal description of the service, the
 * connected-wallet address, the consent-gated OpenSearch UBI analytics and
 * everything downstream of it (its legal basis, its retention, its storage,
 * and the third-party section naming OpenSearch). Sections left empty by those
 * removals are gone, and the remainder is renumbered. A full legal refresh is
 * a separate job; this is the deprecation, not the rewrite.
 */
export default () => (
  <Layout title="Privacy Policy | Wuzzy">
    <article class="legal">
      <h1 class="mt-6 mb-6 text-2xl font-bold">Privacy Policy</h1>

      <p class="text-ink-muted">
        <strong>Effective Date:</strong> November 15, 2025
        <br />
        <strong>Last Updated:</strong> November 15, 2025
      </p>

      <h2>1. Introduction</h2>
      <p>
        Welcome to Wuzzy. We are committed to protecting your privacy and ensuring transparency
        about how we collect, use, and safeguard your information. This Privacy Policy explains
        our practices regarding data collection when you use our search platform.
      </p>

      <h2>2. Who We Are</h2>
      <p>Wuzzy is built and operated by Memetic Block.</p>

      <h2>3. Information We Collect</h2>

      <h3>3.1 Information You Provide</h3>
      <ul>
        <li>
          <strong>Search Queries:</strong> The text, images, or other content you search for
        </li>
        <li>
          <strong>User Preferences:</strong> Display settings, theme preferences stored locally in
          your browser
        </li>
      </ul>

      <h3>3.2 Information We Collect Automatically</h3>
      <ul>
        <li>
          <strong>Technical Information:</strong> Browser type, device type, and approximate
          location (country-level only, based on anonymized IP)
        </li>
      </ul>

      <h3>3.3 Information We Do NOT Collect</h3>
      <ul>
        <li>
          We do <strong>not</strong> use cookies for tracking
        </li>
        <li>
          We do <strong>not</strong> store your full IP address (only anonymized versions for rate
          limiting)
        </li>
        <li>
          We do <strong>not</strong> track you across other websites
        </li>
        <li>
          We do <strong>not</strong> sell your data to third parties
        </li>
        <li>
          We do <strong>not</strong> require you to create an account
        </li>
      </ul>

      <h2>4. How We Use Your Information</h2>

      <h3>4.1 Search Functionality</h3>
      <p>
        Your search queries are processed to retrieve relevant results. Queries may be sent to our
        search API for indexing and retrieval.
      </p>

      <h3>4.2 Service Improvement</h3>
      <p>
        Aggregated, anonymized analytics help us improve search algorithms, fix bugs, and enhance
        the overall user experience.
      </p>

      <h2>5. GDPR Compliance</h2>

      <h3>5.1 Legal Basis for Processing</h3>
      <p>Under the General Data Protection Regulation (GDPR), we process your data based on:</p>
      <ul>
        <li>
          <strong>Legitimate Interest:</strong> For providing search functionality and preventing
          abuse
        </li>
        <li>
          <strong>Contract Performance:</strong> To deliver the search service you request
        </li>
      </ul>

      <h3>5.2 Your Rights Under GDPR</h3>
      <p>If you are located in the European Economic Area (EEA), you have the following rights:</p>
      <ul>
        <li>
          <strong>Right to Access:</strong> Request a copy of your personal data
        </li>
        <li>
          <strong>Right to Rectification:</strong> Correct inaccurate data
        </li>
        <li>
          <strong>Right to Erasure:</strong> Request deletion of your data ("right to be forgotten")
        </li>
        <li>
          <strong>Right to Restriction:</strong> Limit how we use your data
        </li>
        <li>
          <strong>Right to Data Portability:</strong> Receive your data in a structured format
        </li>
        <li>
          <strong>Right to Object:</strong> Object to certain types of processing
        </li>
      </ul>

      <h3>5.3 How to Exercise Your Rights</h3>
      <p>To clear your session data:</p>
      <ol>
        <li>Open your browser's developer tools (F12)</li>
        <li>Go to the "Application" or "Storage" tab</li>
        <li>Clear localStorage for this domain</li>
        <li>Alternatively, use your browser's "Clear browsing data" feature</li>
      </ol>
      <p>For other requests or questions, please contact us (contact information below).</p>

      <h2>6. Data Storage and Security</h2>

      <h3>6.1 Where We Store Data</h3>
      <ul>
        <li>
          <strong>Your Browser:</strong> Preferences in localStorage (fully under your control)
        </li>
      </ul>

      <h3>6.2 Data Retention</h3>
      <ul>
        <li>
          <strong>Session Data:</strong> Stored in your browser until you clear it (no server-side
          storage)
        </li>
        <li>
          <strong>Search Queries:</strong> Not permanently stored on our servers
        </li>
      </ul>

      <h3>6.3 Security Measures</h3>
      <ul>
        <li>HTTPS encryption for all data in transit</li>
        <li>IP anonymization (last octet removed for IPv4, last 4 segments for IPv6)</li>
        <li>Rate limiting to prevent abuse</li>
        <li>Regular security audits and updates</li>
      </ul>

      <h2>7. Third-Party Services</h2>

      <h3>7.1 No Third-Party Tracking</h3>
      <p>
        We do not use Google Analytics, Facebook Pixel, or any other third-party tracking scripts.
      </p>

      <h2>8. Children's Privacy</h2>
      <p>
        Wuzzy is not directed at children under the age of 13. We do not knowingly collect personal
        information from children. If you believe we have inadvertently collected information from
        a child, please contact us immediately.
      </p>

      <h2>9. International Data Transfers</h2>
      <p>
        Your data may be processed in countries outside the EEA. We ensure adequate safeguards are
        in place, including:
      </p>
      <ul>
        <li>Data anonymization and minimization</li>
        <li>Encryption in transit and at rest</li>
        <li>Compliance with GDPR transfer requirements</li>
      </ul>

      <h2>10. Changes to This Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. Changes will be posted on this page
        with an updated "Last Updated" date. Significant changes will be prominently announced on
        the platform.
      </p>

      <h2>11. Contact Us</h2>
      <p>
        If you have questions, concerns, or requests regarding this Privacy Policy or your data:
      </p>
      <ul>
        <li>
          <strong>GitHub:</strong>{' '}
          <a href={`${site.repo}/issues`} target="_blank" rel="noopener noreferrer">
            Open an issue
          </a>
        </li>
        <li>
          <strong>Email:</strong> <a href={`mailto:${site.legalEmail}`}>{site.legalEmail}</a>
        </li>
      </ul>

      <h2>12. Open Source Transparency</h2>
      <p>
        Wuzzy is an open-source project. You can review our code and privacy practices on GitHub:
      </p>
      <ul>
        <li>
          <a href={site.repo} target="_blank" rel="noopener noreferrer">
            Wuzzy Repository
          </a>
        </li>
      </ul>

      <hr class="rule-double my-10 border-0" />

      <p class="text-ink-muted text-sm">
        This Privacy Policy is provided in good faith to ensure transparency and compliance with
        applicable privacy laws, including GDPR. By using Wuzzy, you acknowledge that you have read
        and understood this policy.
      </p>

      <p class="mt-8 flex gap-4">
        <a href="/" class="border-ink border-2 px-3 py-1 no-underline">
          Back to Home
        </a>
        <a href="/terms" class="border-ink border-2 px-3 py-1 no-underline">
          Terms of Service
        </a>
      </p>
    </article>
  </Layout>
);
