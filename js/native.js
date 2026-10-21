/**
 * The iOS/Android app (Capacitor) runs the same files as the website. Here are
 * the few places where the app uses the phone instead of the browser: sign-in,
 * sharing and saving files, printing and haptics. On the website every helper
 * returns false or does nothing, so the browser code path runs as before.
 */
var isNativeApp = !!(window.Capacitor && typeof Capacitor.isNativePlatform === 'function'
  && Capacitor.isNativePlatform());

function nativePlugin(name) {
  if (!isNativeApp || !Capacitor.Plugins) return null;
  return Capacitor.Plugins[name] || null;
}

// Light tap feedback, e.g. when a guest lands on a seat.
function hapticTap() {
  var h = nativePlugin('Haptics');
  if (h) h.impact({ style: 'LIGHT' }).catch(function () {});
}

function hapticWarning() {
  var h = nativePlugin('Haptics');
  if (h) h.notification({ type: 'WARNING' }).catch(function () {});
}

// Opens the iOS/Android share sheet with text. Returns false when it could not.
async function nativeShareText(title, text) {
  var share = nativePlugin('Share');
  if (!share) return false;
  try {
    await share.share({ title: title, text: text, dialogTitle: title });
  } catch (e) {
    // Closing the share sheet rejects too; that is not an error for the user.
  }
  return true;
}

// Writes the file to the app's cache and opens the share sheet, where the user
// picks "Save to Files", Mail, WhatsApp... Returns false when it could not.
async function nativeSaveFile(filename, content) {
  var fs = nativePlugin('Filesystem');
  var share = nativePlugin('Share');
  if (!fs || !share) return false;
  var written = await fs.writeFile({ path: filename, data: content, directory: 'CACHE', encoding: 'utf8' });
  try {
    await share.share({ title: filename, files: [written.uri], dialogTitle: filename });
  } catch (e) {
    // Share sheet closed without choosing anything.
  }
  return true;
}

// The web view ignores window.print(), so the app prints the page (with its
// @media print styles) through the native print dialog.
async function nativePrint(jobName) {
  var printer = nativePlugin('Printer');
  if (!printer) return false;
  await printer.printWebView({ name: jobName });
  return true;
}

// ── Sign-in ───────────────────────────────────────────────────────────────────
// Google's sign-in popup does not open inside the app. The native plugin shows
// the system Google/Apple screen and returns a token; the Firebase web SDK then
// signs in with it, so Firestore and the rest of the app work unchanged.

function nativeAuthCredential(providerId, result) {
  var c = (result && result.credential) || {};
  if (providerId === 'apple.com') {
    return new firebase.auth.OAuthProvider('apple.com').credential({ idToken: c.idToken, rawNonce: c.nonce });
  }
  return firebase.auth.GoogleAuthProvider.credential(c.idToken);
}

// Shows the native sign-in screen and returns { credential, authorizationCode }.
// authorizationCode (Apple only) is needed to revoke Apple's tokens when the
// account is deleted.
async function nativeSignInCredential(providerId) {
  var fa = nativePlugin('FirebaseAuthentication');
  if (!fa) throw new Error('Prijava nije dostupna u ovoj verziji aplikacije.');
  var result = providerId === 'apple.com'
    ? await fa.signInWithApple({ skipNativeAuth: true })
    : await fa.signInWithGoogle({ skipNativeAuth: true });
  return {
    credential: nativeAuthCredential(providerId, result),
    authorizationCode: result && result.credential ? result.credential.authorizationCode : null
  };
}

async function nativeSignOut() {
  var fa = nativePlugin('FirebaseAuthentication');
  if (fa) await fa.signOut().catch(function () {});
}

if (isNativeApp) document.documentElement.classList.add('native-app');
