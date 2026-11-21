import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy — Revixa Dealer Portal & Mobile App',
  description: 'Privacy Policy for Revixa Dealer Portal and Revixa Dealer Mobile App operated by Appalachian Growth Solutions.',
};

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Header / Navbar */}
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur sticky top-0 z-10 shadow-xs">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-slate-900 hover:text-indigo-600 font-bold text-lg tracking-tight transition-colors">
            <span className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-extrabold text-sm shadow-xs">R</span>
            <span>Revixa</span>
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
              Legal & Compliance
            </div>
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900 font-heading">
              Privacy Policy — Revixa Dealer Portal &amp; Mobile App
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
                <a href="https://revixasolutions.com" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">
                  https://revixasolutions.com
                </a>
              </div>
            </div>
          </div>

          {/* Section 1 */}
          <section className="space-y-3">
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 font-heading">1. Overview</h2>
            <p className="text-sm sm:text-base leading-relaxed text-slate-700">
              Appalachian Growth Solutions (&ldquo;we,&rdquo; &ldquo;our,&rdquo; or &ldquo;us&rdquo;) develops and operates the Revixa Dealer Portal (
              <a href="https://revixasolutions.com" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">
                https://revixasolutions.com
              </a>
              ) and the Revixa Dealer Mobile App (collectively, the &ldquo;Service&rdquo;). This Privacy Policy explains how we collect, use, store, and safeguard information when authorized automotive dealerships, dealership owners, and dealership staff members (&ldquo;you&rdquo; or &ldquo;Dealers&rdquo;) access or use our Service.
            </p>
          </section>

          {/* Section 2 */}
          <section className="space-y-4">
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 font-heading">2. Information We Collect</h2>
            <p className="text-sm sm:text-base leading-relaxed text-slate-700">
              We collect information required to deliver, secure, and operate our dealership software platform:
            </p>
            <ul className="space-y-3 pl-1 sm:pl-2 text-sm sm:text-base text-slate-700">
              <li className="flex items-start gap-2">
                <span className="text-indigo-600 font-bold mt-1">•</span>
                <div>
                  <strong className="text-slate-900">Account &amp; Dealership Profile Information:</strong> Full name, email address, phone number, dealership name, dealership address, and encrypted password/authentication credentials.
                </div>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-indigo-600 font-bold mt-1">•</span>
                <div>
                  <strong className="text-slate-900">Vehicle Inventory &amp; Media:</strong> Vehicle specifications (VIN, make, model, year, mileage, pricing, features, descriptions) and vehicle photographs/documents uploaded via device camera or photo gallery.
                </div>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-indigo-600 font-bold mt-1">•</span>
                <div>
                  <strong className="text-slate-900">Facebook / Meta Page Connection Data:</strong> When a dealership voluntarily connects its Facebook Page via Meta&apos;s official authentication flow, we receive and store authorized Meta Page Access Tokens, Page IDs, and Page Names solely to publish vehicle listings and updates on their behalf. We never collect or store personal Facebook passwords.
                </div>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-indigo-600 font-bold mt-1">•</span>
                <div>
                  <strong className="text-slate-900">Customer &amp; Lead Data:</strong> Prospective car buyer details (names, phone numbers, email addresses, vehicle inquiries) entered into the dealership CRM or received from the dealership storefront.
                </div>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-indigo-600 font-bold mt-1">•</span>
                <div>
                  <strong className="text-slate-900">Technical, Diagnostic &amp; Usage Information:</strong> Basic device identifiers, app version, IP/session logs, and crash diagnostics required for security and reliable app performance.
                </div>
              </li>
            </ul>
          </section>

          {/* Section 3 */}
          <section className="space-y-3">
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 font-heading">3. How We Use Your Information</h2>
            <p className="text-sm sm:text-base leading-relaxed text-slate-700">
              We use collected information solely for business purposes related to operating our services:
            </p>
            <ul className="space-y-2 pl-1 sm:pl-2 text-sm sm:text-base text-slate-700">
              <li className="flex items-start gap-2">
                <span className="text-indigo-600 font-bold mt-1">•</span>
                <span>Authentication &amp; multi-tenant access control;</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-indigo-600 font-bold mt-1">•</span>
                <span>Managing vehicle inventory, website listings, and authorized inventory syndication feeds;</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-indigo-600 font-bold mt-1">•</span>
                <span>Publishing vehicle posts/photos to connected Facebook Pages at the dealer&apos;s explicit direction;</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-indigo-600 font-bold mt-1">•</span>
                <span>Sending transactional notifications, security alerts, and support responses.</span>
              </li>
            </ul>
          </section>

          {/* Section 4 */}
          <section className="space-y-3">
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 font-heading">4. Data Sharing &amp; Third-Party Services</h2>
            <p className="text-sm sm:text-base leading-relaxed text-slate-700">
              We do not sell, rent, or trade personal or dealership data. Information is shared strictly under the following limited conditions:
            </p>
            <ul className="space-y-2 pl-1 sm:pl-2 text-sm sm:text-base text-slate-700">
              <li className="flex items-start gap-2">
                <span className="text-indigo-600 font-bold mt-1">•</span>
                <div>
                  <strong className="text-slate-900">Cloud Hosting &amp; Database Infrastructure:</strong> Trusted cloud hosting providers that maintain high-security standards to store our database and media files.
                </div>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-indigo-600 font-bold mt-1">•</span>
                <div>
                  <strong className="text-slate-900">Meta Platforms:</strong> Facebook Graph API when connected by the dealer to publish inventory updates.
                </div>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-indigo-600 font-bold mt-1">•</span>
                <div>
                  <strong className="text-slate-900">Authorized Feed Partners:</strong> Vehicle classified syndication partners only when explicitly enabled for the dealership.
                </div>
              </li>
            </ul>
          </section>

          {/* Section 5 */}
          <section className="space-y-3">
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 font-heading">5. Data Security &amp; Multi-Tenant Separation</h2>
            <p className="text-sm sm:text-base leading-relaxed text-slate-700">
              We apply industry-standard security safeguards including encrypted HTTPS/TLS transmission, hashed passwords, role-based access controls, and strict multi-tenant data isolation so no dealership can view or access another dealership&apos;s inventory, leads, or integration credentials.
            </p>
          </section>

          {/* Section 6 */}
          <section className="space-y-3">
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 font-heading">6. Data Retention &amp; Account Deletion</h2>
            <p className="text-sm sm:text-base leading-relaxed text-slate-700">
              Information is retained while the dealership account is active. Users can permanently delete their account directly inside the mobile app via <strong className="text-slate-900">Settings -&gt; Delete Account</strong>, or via our Account Deletion page (
              <a href="https://revixasolutions.com/delete-account" className="text-indigo-600 hover:underline">
                https://revixasolutions.com/delete-account
              </a>
              ) or by emailing{' '}
              <a href="mailto:appalachiangrowth@gmail.com" className="text-indigo-600 hover:underline">
                appalachiangrowth@gmail.com
              </a>
              . Upon deletion, user profile, login credentials, and stored Facebook Page access tokens are permanently removed within 30 days (unless retention is required by law).
            </p>
          </section>

          {/* Section 7 */}
          <section className="space-y-3">
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 font-heading">7. Children&apos;s Privacy</h2>
            <p className="text-sm sm:text-base leading-relaxed text-slate-700">
              Our platform is a B2B platform intended strictly for authorized automotive dealership professionals aged 18 and older; we do not knowingly collect data from children under 18.
            </p>
          </section>

          {/* Section 8 */}
          <section className="space-y-3">
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 font-heading">8. Changes to This Privacy Policy</h2>
            <p className="text-sm sm:text-base leading-relaxed text-slate-700">
              Updates to this Privacy Policy will be posted on this page with an updated Effective Date.
            </p>
          </section>

          {/* Section 9 */}
          <section className="space-y-3 border-t border-slate-200 pt-6">
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 font-heading">9. Contact Us</h2>
            <p className="text-sm sm:text-base leading-relaxed text-slate-700">
              If you have any questions, concerns, or requests regarding this Privacy Policy or your personal data, please contact:
            </p>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm sm:text-base text-slate-800 space-y-1">
              <div><strong className="text-slate-900">Developer / Operator:</strong> Appalachian Growth Solutions</div>
              <div>
                <strong className="text-slate-900">Email:</strong>{' '}
                <a href="mailto:appalachiangrowth@gmail.com" className="text-indigo-600 hover:underline">
                  appalachiangrowth@gmail.com
                </a>
              </div>
              <div>
                <strong className="text-slate-900">Website:</strong>{' '}
                <a href="https://revixasolutions.com" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">
                  https://revixasolutions.com
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
              Dealer Portal
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
