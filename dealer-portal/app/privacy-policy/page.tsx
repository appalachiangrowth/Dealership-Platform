import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy — Appalachian Growth Solutions Dealer Portal & Mobile App',
  description: 'Privacy Policy for Appalachian Growth Solutions Dealer Portal & Mobile App operated by Appalachian Growth Solutions.',
};

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Header / Navbar */}
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur sticky top-0 z-10 shadow-xs">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-slate-900 hover:text-indigo-600 font-bold text-lg tracking-tight transition-colors">
            <span className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-extrabold text-sm shadow-xs">A</span>
            <span>Appalachian Growth Solutions</span>
          </Link>
          <div className="flex items-center gap-4 text-sm font-medium">
            <Link href="/delete-account" className="text-slate-600 hover:text-slate-900 transition-colors">
              Account Deletion
            </Link>
            <Link href="/login" className="px-3.5 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors shadow-xs">
              Dealer Login
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        <article className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-6 sm:p-10 md:p-12 space-y-8">
          {/* Header block */}
          <div className="border-b border-slate-200 pb-8 space-y-3">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100">
              Legal &amp; Privacy Policy
            </div>
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900 font-heading">
              Privacy Policy — Appalachian Growth Solutions Dealer Portal &amp; Mobile App
            </h1>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 text-xs sm:text-sm text-slate-600">
              <div>
                <span className="font-semibold text-slate-800">Effective Date / Last Updated:</span> November 21, 2026
              </div>
              <div>
                <span className="font-semibold text-slate-800">Developer / Operator:</span> Appalachian Growth Solutions (
                <a href="mailto:appalachiangrowth@gmail.com" className="text-indigo-600 hover:underline">
                  appalachiangrowth@gmail.com
                </a>
                )
              </div>
              <div>
                <span className="font-semibold text-slate-800">Platform Website:</span>{' '}
                <a href="https://appalachiangrowthsolutions.com" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">
                  https://appalachiangrowthsolutions.com
                </a>
              </div>
            </div>
          </div>

          {/* Section 1 */}
          <section className="space-y-3">
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 font-heading">1. Overview</h2>
            <p className="text-sm sm:text-base leading-relaxed text-slate-700">
              Appalachian Growth Solutions (&ldquo;we,&rdquo; &ldquo;our,&rdquo; or &ldquo;us&rdquo;) develops and operates the Appalachian Growth Solutions Dealer Portal (
              <a href="https://appalachiangrowthsolutions.com" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">
                https://appalachiangrowthsolutions.com
              </a>
              ) and the Appalachian Growth Solutions Dealer Mobile App (collectively, the &ldquo;Service&rdquo;). This Privacy Policy explains how we collect, use, store, and protect information when authorized automotive dealerships, dealership owners, and dealership staff members (&ldquo;you&rdquo; or &ldquo;Dealers&rdquo;) access or use our Service.
            </p>
          </section>

          {/* Section 2 */}
          <section className="space-y-4">
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 font-heading">2. Information We Collect</h2>
            <p className="text-sm sm:text-base leading-relaxed text-slate-700">
              We collect only the information necessary to provide, secure, and operate our dealership software platform:
            </p>
            <ul className="space-y-3 pl-1 sm:pl-2 text-sm sm:text-base text-slate-700">
              <li className="flex items-start gap-2">
                <span className="text-indigo-600 font-bold mt-1">•</span>
                <div>
                  <strong className="text-slate-900">Account &amp; Dealership Profile Information:</strong> User display name, login username, email address, phone number, role, dealership business profile details (dealership name, physical address, business hours, contact numbers), and salted bcrypt cryptographic password hashes. We never store plain-text passwords.
                </div>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-indigo-600 font-bold mt-1">•</span>
                <div>
                  <strong className="text-slate-900">Vehicle Inventory &amp; Media:</strong> Vehicle specifications (VIN, year, make, model, trim, mileage, price, features, description, stock number) and vehicle photographs or documents uploaded via camera, gallery, or batch CSV/XML inventory feeds.
                </div>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-indigo-600 font-bold mt-1">•</span>
                <div>
                  <strong className="text-slate-900">Customer &amp; Dealership Lead Data:</strong> Inquiries submitted by prospective car buyers through your dealership storefront website (buyer name, phone number, email address, message, and vehicle of interest) or entered into your deal jacket and CRM forms.
                </div>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-indigo-600 font-bold mt-1">•</span>
                <div>
                  <strong className="text-slate-900">Technical &amp; Audit Logs:</strong> Client IP addresses, session tokens, audit timestamps, and operational event logs strictly used for security auditing, fraud prevention, and system diagnostics.
                </div>
              </li>
            </ul>
          </section>

          {/* Section 3 */}
          <section className="space-y-3">
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 font-heading">3. How We Use Your Information</h2>
            <p className="text-sm sm:text-base leading-relaxed text-slate-700">
              We process information solely to provide authorized services to your dealership:
            </p>
            <ul className="space-y-2 pl-1 sm:pl-2 text-sm sm:text-base text-slate-700">
              <li className="flex items-start gap-2">
                <span className="text-indigo-600 font-bold mt-1">•</span>
                <span>Authenticating authorized dealership staff and enforcing multi-tenant role-based permissions;</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-indigo-600 font-bold mt-1">•</span>
                <span>Powering your dealership website inventory, deal structuring, and lead management;</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-indigo-600 font-bold mt-1">•</span>
                <span>Generating and transmitting inventory syndication feeds (such as CarGurus SFTP feeds, CSV, and XML feeds) when configured by your dealership;</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-indigo-600 font-bold mt-1">•</span>
                <span>Delivering lead notifications and security audit logs to authorized dealership personnel.</span>
              </li>
            </ul>
          </section>

          {/* Section 4 */}
          <section className="space-y-3">
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 font-heading">4. Data Sharing &amp; Third-Party Services</h2>
            <p className="text-sm sm:text-base leading-relaxed text-slate-700">
              <strong className="text-slate-900">We do not sell, rent, or monetize your personal or dealership data.</strong> We do not run third-party advertising tracking networks. Information is disclosed solely in the following operational scenarios:
            </p>
            <ul className="space-y-2 pl-1 sm:pl-2 text-sm sm:text-base text-slate-700">
              <li className="flex items-start gap-2">
                <span className="text-indigo-600 font-bold mt-1">•</span>
                <div>
                  <strong className="text-slate-900">Secure Cloud Infrastructure:</strong> Dedicated hosting and database servers running PostgreSQL and file storage services operated under strict access controls.
                </div>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-indigo-600 font-bold mt-1">•</span>
                <div>
                  <strong className="text-slate-900">Authorized Inventory Syndication Partners:</strong> Third-party vehicle marketplaces (such as CarGurus via secure SFTP or export feeds) only when explicitly configured and enabled by the dealership.
                </div>
              </li>
            </ul>
          </section>

          {/* Section 5 */}
          <section className="space-y-3">
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 font-heading">5. Data Security &amp; Multi-Tenant Separation</h2>
            <p className="text-sm sm:text-base leading-relaxed text-slate-700">
              Our architecture enforces strict multi-tenant database isolation. Every database query is scoped to the authenticated dealership&apos;s unique identifier, preventing cross-tenant access. All communications are encrypted in transit over HTTPS/TLS, and credentials use cryptographic salted hashes.
            </p>
          </section>

          {/* Section 6 */}
          <section className="space-y-3">
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 font-heading">6. Data Retention &amp; Immediate Account Deletion</h2>
            <p className="text-sm sm:text-base leading-relaxed text-slate-700">
              Dealership users have full control over their account lifecycle. You may deactivate and delete your user account immediately at any time:
            </p>
            <ul className="space-y-2 pl-1 sm:pl-2 text-sm sm:text-base text-slate-700">
              <li className="flex items-start gap-2">
                <span className="text-indigo-600 font-bold mt-1">•</span>
                <div>
                  <strong className="text-slate-900">In-App Immediate Deactivation:</strong> Authenticated users can navigate to <strong className="text-slate-900">Settings → Delete Account</strong>. When confirmed, your user account is immediately disabled, session caches are purged, active login tokens are invalidated, and an audit record is logged.
                </div>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-indigo-600 font-bold mt-1">•</span>
                <div>
                  <strong className="text-slate-900">Email Deletion Request:</strong> If you cannot access the app, you may email <a href="mailto:appalachiangrowth@gmail.com" className="text-indigo-600 hover:underline">appalachiangrowth@gmail.com</a> with the subject &ldquo;Account Deletion Request&rdquo; to have our administrative team process the deactivation.
                </div>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-indigo-600 font-bold mt-1">•</span>
                <div>
                  <strong className="text-slate-900">Dealership Data Scope:</strong> Deleting an individual staff account disables that user&apos;s access immediately. Shared dealership inventory, deals, and customer lead records remain under the control of the dealership&apos;s surviving administrators.
                </div>
              </li>
            </ul>
          </section>

          {/* Section 7 */}
          <section className="space-y-3">
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 font-heading">7. Children&apos;s Privacy</h2>
            <p className="text-sm sm:text-base leading-relaxed text-slate-700">
              Our Service is a business-to-business platform exclusively intended for commercial automotive dealerships and authorized professionals aged 18 and older. We do not knowingly collect or solicit personal information from children under 18.
            </p>
          </section>

          {/* Section 8 */}
          <section className="space-y-3">
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 font-heading">8. Changes to This Privacy Policy</h2>
            <p className="text-sm sm:text-base leading-relaxed text-slate-700">
              We may update this Privacy Policy from time to time to reflect operational or legal updates. Any modifications will be posted directly to this page with an updated Effective Date.
            </p>
          </section>

          {/* Section 9 */}
          <section className="space-y-3 border-t border-slate-200 pt-6">
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 font-heading">9. Contact Us</h2>
            <p className="text-sm sm:text-base leading-relaxed text-slate-700">
              If you have any questions or inquiries regarding this Privacy Policy or account data practices, please contact us:
            </p>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm sm:text-base text-slate-800 space-y-1">
              <div><strong className="text-slate-900">Developer &amp; Operator:</strong> Appalachian Growth Solutions</div>
              <div>
                <strong className="text-slate-900">Email:</strong>{' '}
                <a href="mailto:appalachiangrowth@gmail.com" className="text-indigo-600 hover:underline">
                  appalachiangrowth@gmail.com
                </a>
              </div>
              <div>
                <strong className="text-slate-900">Platform Website:</strong>{' '}
                <a href="https://appalachiangrowthsolutions.com" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">
                  https://appalachiangrowthsolutions.com
                </a>
              </div>
            </div>
          </section>
        </article>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-8 text-center text-xs sm:text-sm text-slate-500">
        <div className="max-w-4xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p>© {new Date().getFullYear()} Appalachian Growth Solutions. All rights reserved.</p>
          <div className="flex gap-4">
            <Link href="/privacy-policy" className="text-slate-700 hover:underline">
              Privacy Policy
            </Link>
            <Link href="/delete-account" className="text-slate-700 hover:underline">
              Account Deletion
            </Link>
            <Link href="/login" className="text-slate-700 hover:underline">
              Dealer Login
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
