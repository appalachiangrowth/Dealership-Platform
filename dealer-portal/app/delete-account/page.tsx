import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Account Deletion — Appalachian Growth Solutions Dealer Portal & Mobile App',
  description: 'Instructions on how to immediately deactivate and delete your Appalachian Growth Solutions Dealer user account and personal data.',
};

export default function DeleteAccountPage() {
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
            <Link href="/privacy-policy" className="text-slate-600 hover:text-slate-900 transition-colors">
              Privacy Policy
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
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-100">
              User Data &amp; Account Lifecycle
            </div>
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900 font-heading">
              Account Deletion — Appalachian Growth Solutions Dealer Portal &amp; Mobile App
            </h1>
            <p className="text-sm sm:text-base text-slate-600 max-w-2xl leading-relaxed">
              In accordance with Google Play Store data safety policies and user data rights, Appalachian Growth Solutions provides authorized dealership staff and administrators with immediate self-service account deletion and administrative deletion request options.
            </p>
          </div>

          {/* Option 1 */}
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-xs">1</span>
              <h2 className="text-lg sm:text-xl font-bold text-slate-900 font-heading">Option 1: In-App Immediate Deletion (Recommended)</h2>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-3">
              <p className="text-sm sm:text-base text-slate-700 leading-relaxed">
                If you currently have the mobile app installed and have active login credentials:
              </p>
              <ol className="list-decimal list-inside space-y-2 text-sm sm:text-base text-slate-800 font-medium pl-1">
                <li>Open the <strong className="text-slate-900">Appalachian Growth Solutions Dealer Mobile App</strong>.</li>
                <li>Log in to your authorized dealership user account.</li>
                <li>Go to the <strong className="text-slate-900">Settings</strong> tab and scroll to the <strong className="text-slate-900">Danger Zone</strong> section.</li>
                <li>Tap <strong className="text-rose-600 font-bold">Delete Account</strong> and confirm the permanent deletion dialog.</li>
              </ol>
              <p className="text-xs sm:text-sm text-slate-600 mt-2">
                Upon confirmation, your user account is immediately disabled, authentication cache is purged, and your active session is logged out.
              </p>
            </div>
          </section>

          {/* Option 2 */}
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-xs">2</span>
              <h2 className="text-lg sm:text-xl font-bold text-slate-900 font-heading">Option 2: Email Deletion Request (Without App Access)</h2>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-3">
              <p className="text-sm sm:text-base text-slate-700 leading-relaxed">
                If you have uninstalled the mobile app, lost your device, or cannot log in:
              </p>
              <p className="text-sm sm:text-base text-slate-800 font-medium">
                Email{' '}
                <a href="mailto:appalachiangrowth@gmail.com?subject=Account%20Deletion%20Request" className="text-indigo-600 hover:underline font-semibold">
                  appalachiangrowth@gmail.com
                </a>{' '}
                from your registered email address with the subject <strong className="text-slate-900">&ldquo;Account Deletion Request&rdquo;</strong>, including your full name, username, and dealership name.
              </p>
              <div className="text-xs sm:text-sm text-slate-600 border-l-2 border-indigo-400 pl-3 py-0.5">
                Our operations team will verify your identity, process the account deletion within 48 business hours, and send a written confirmation once completed.
              </div>
            </div>
          </section>

          {/* Account Deletion Scope & Retention */}
          <section className="space-y-4 border-t border-slate-200 pt-6">
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 font-heading">Account Deletion Scope &amp; Data Handling</h2>
            <div className="bg-amber-50/70 border border-amber-200/80 rounded-xl p-5 text-sm sm:text-base text-amber-950 leading-relaxed space-y-3">
              <div>
                <strong className="text-amber-950 font-bold block mb-1">What Happens Immediately Upon Deletion:</strong>
                <ul className="list-disc list-inside space-y-1 text-sm text-amber-900">
                  <li>Your user login profile is immediately disabled in the database.</li>
                  <li>Authentication tokens and active sessions are revoked instantly.</li>
                  <li>You will no longer be able to log in to the Dealer Portal or Mobile App.</li>
                  <li>An immutable audit log of the deletion action is recorded for security and compliance.</li>
                </ul>
              </div>
              <div className="text-xs sm:text-sm text-amber-900/90 border-t border-amber-200 pt-3">
                <strong>Dealership Organization Data:</strong> Vehicle inventory records, customer leads, and deal jackets created within your dealership organization remain available to your dealership&apos;s active administrators, as these constitute organizational business assets of the dealership.
              </div>
            </div>
          </section>

          {/* Contact and Operator Information */}
          <section className="space-y-3 border-t border-slate-200 pt-6">
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 font-heading">Developer / Operator Contact</h2>
            <div className="text-sm sm:text-base text-slate-700 space-y-1">
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
