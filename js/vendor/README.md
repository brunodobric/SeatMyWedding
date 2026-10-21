Firebase JS SDK 10.14.1 (compat builds), copied from the `firebase` npm
package so the app does not load third-party scripts at runtime and keeps
working offline. Apache License 2.0, https://github.com/firebase/firebase-js-sdk

To update: `npm pack firebase@<version>`, copy `firebase-{app,auth,firestore}-compat.js`
from the package root here, and bump CACHE_NAME in sw.js.
