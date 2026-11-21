import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Account Deletion — Revixa Dealer Portal & Mobile App',
  description: 'Instructions on how to permanently delete your Revixa Dealer user account and associated personal data.',
};

export default function DeleteAccountPage() {
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
              User Data &amp; Account Management
            </div>
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900 font-heading">
              Account Deletion — Revixa Dealer Portal &amp; Mobile App
            </h1>
            <p className="text-sm sm:text-base text-slate-600 max-w-2xl leading-relaxed">
              In accordance with Google Play Store data safety and developer guidelines, Revixa provides authorized dealership users with simple and direct methods to request or execute permanent deletion of their account and associated personal data.
            </p>
          </div>

          {/* Option 1 */}
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-xs">1</span>
              <h2 className="text-lg sm:text-xl font-bold text-slate-900 font-heading">Option 1: In-App Deletion (Immediate)</h2>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-3">
              <p className="text-sm sm:text-base text-slate-700 leading-relaxed">
                If you currently have the mobile application installed on your device:
              </p>
              <ol className="list-decimal list-inside space-y-2 text-sm sm:text-base text-slate-800 font-medium pl-1">
                <li>Open the <strong className="text-slate-900">Revixa Dealer Mobile App</strong>.</li>
                <li>Log in to your authorized dealership user account.</li>
                <li>Navigate to <strong className="text-slate-900">Settings → Delete Account</strong>.</li>
                <li>Confirm the prompt to permanently delete your user account immediately.</li>
              </ol>
            </div>
          </section>

          {/* Option 2 */}
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-xs">2</span>
              <h2 className="text-lg sm:text-xl font-bold text-slate-900 font-heading">Option 2: Email Request (Without App Access)</h2>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-3">
              <p className="text-sm sm:text-base text-slate-700 leading-relaxed">
                If you have uninstalled the app or cannot log in, email{' '}
                <a href="mailto:appalachiangrowth@gmail.com?subject=Account%20Deletion%20Request" className="text-indigo-600 hover:underline font-semibold">
                  appalachiangrowth@gmail.com
                </a>{' '}
                from your registered email address with the subject <strong className="text-slate-900">&ldquo;Account Deletion Request&rdquo;</strong> and your dealership name.
              </p>
              <div className="text-xs sm:text-sm text-slate-600 border-l-2 border-indigo-400 pl-3 py-0.5">
                Our support team will process your request within 48 business hours and send a written confirmation once completed.
              </div>
            </div>
          </section>

          {/* Data Deleted & Retention */}
          <section className="space-y-4 border-t border-slate-200 pt-6">
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 font-heading">Data Deleted &amp; Retention</h2>
            <div className="bg-amber-50/70 border border-amber-200/80 rounded-xl p-5 text-sm sm:text-base text-amber-950 leading-relaxed space-y-2">
              <p>
                Upon deletion, your user profile, login credentials, and stored Facebook Page access tokens are permanently deleted from active systems within 30 days (except minimal records required by legal or financial obligations).
              </p>
              <p className="text-xs sm:text-sm text-amber-900/80">
                Shared dealership inventory and lead records created by your dealership may remain in your dealership organization&apos;s workspace if other authorized dealership members maintain active accounts.
              </p>
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
