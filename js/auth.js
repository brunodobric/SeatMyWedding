/**
 * Firebase Authentication – Google + Email/Password
 */
var currentUser = null;

function isAuthConfigured() {
  try {
    if (typeof firebase === 'undefined') return false;
    if (typeof firebaseConfig !== 'undefined' && firebaseConfig && firebaseConfig.apiKey
        && firebaseConfig.apiKey !== 'YOUR_API_KEY') {
      return true;
    }
    if (!firebase.apps || !firebase.apps.length) return false;
    var cfg = firebase.app().options;
    return !!(cfg && cfg.apiKey && cfg.apiKey !== 'YOUR_API_KEY');
  } catch (e) {
    return false;
  }
}

function getAuth() {
  try {
    return (typeof auth !== 'undefined' && auth) ? auth : firebase.auth();
  } catch (e) {
    return null;
  }
}

function setupAuth() {
  var loginBtn = document.getElementById('btn-login');
  var btnLogout = document.getElementById('btn-logout');
  var modal = document.getElementById('modal-login');

  // Gumb PRIJAVA uvijek vidljiv dok nije ulogiran – nikad ne skrivamo zbog configa
  if (loginBtn) {
    loginBtn.style.display = '';
    loginBtn.hidden = false;
    loginBtn.addEventListener('click', function () {
      if (!isAuthConfigured() || !getAuth()) {
        if (typeof showToast === 'function') {
          showToast('Prijava nije dostupna – provjeri internet i Firebase postavke.', true);
        } else {
          alert('Prijava nije dostupna.');
        }
        return;
      }
      openLoginModal();
    });
  }

  var a = getAuth();
  if (!a) {
    console.warn('[Firebase] Auth nije spreman pri setupu – gumb ostaje, radit će kad Firebase učita.');
    // Pokušaj kasnije
    setTimeout(function () {
      var a2 = getAuth();
      if (a2) {
        a2.onAuthStateChanged(function (user) {
          currentUser = user;
          updateAuthUI(user);
          window.dispatchEvent(new CustomEvent('authChange', { detail: { user: user } }));
        });
      }
    }, 1500);
  } else {
    a.onAuthStateChanged(function (user) {
      currentUser = user;
      updateAuthUI(user);
      window.dispatchEvent(new CustomEvent('authChange', { detail: { user: user } }));
    });
  }

  if (btnLogout) {
    btnLogout.addEventListener('click', async function () {
      try {
        var authInst = getAuth();
        // On a shared device the guest list should not stay behind.
        var wipe = confirm('Obrisati podatke vjenčanja s ovog uređaja?\n\n'
          + 'Ostaju spremljeni u vašem računu i vratit će se kad se ponovno prijavite. '
          + 'Odaberite Odustani ako i dalje koristite ovaj uređaj.');
        if (typeof flushCloudPush === 'function') await flushCloudPush();
        if (authInst) await authInst.signOut();
        if (typeof nativeSignOut === 'function') await nativeSignOut();
        if (wipe && typeof wipeLocalData === 'function') {
          await wipeLocalData();
          await clearFirestoreCache();
          location.reload();
          return;
        }
        closeLoginModal();
        showToast('Odjavljeni ste');
      } catch (err) {
        showToast('Greška pri odjavi: ' + err.message, true);
      }
    });
  }

  var btnGoogle = document.getElementById('btn-google-login');
  if (btnGoogle) {
    btnGoogle.addEventListener('click', async function () {
      setLoginLoading(true);
      try {
        var authInst = getAuth();
        if (isNativeApp) {
          var signIn = await nativeSignInCredential('google.com');
          await authInst.signInWithCredential(signIn.credential);
        } else {
          var provider = new firebase.auth.GoogleAuthProvider();
          provider.setCustomParameters({ prompt: 'select_account' });
          await authInst.signInWithPopup(provider);
        }
        closeLoginModal();
        showToast('Uspješna prijava!');
      } catch (err) {
        handleAuthError(err);
      } finally {
        setLoginLoading(false);
      }
    });
  }

  var btnApple = document.getElementById('btn-apple-login');
  if (btnApple && isNativeApp && Capacitor.getPlatform() === 'ios') {
    btnApple.hidden = false;
    btnApple.addEventListener('click', async function () {
      setLoginLoading(true);
      try {
        var signIn = await nativeSignInCredential('apple.com');
        await getAuth().signInWithCredential(signIn.credential);
        closeLoginModal();
        showToast('Uspješna prijava!');
      } catch (err) {
        handleAuthError(err);
      } finally {
        setLoginLoading(false);
      }
    });
  }

  var btnDelete = document.getElementById('btn-delete-account');
  if (btnDelete) btnDelete.addEventListener('click', deleteAccount);

  var tabLogin = document.getElementById('tab-login');
  var tabRegister = document.getElementById('tab-register');
  var formLogin = document.getElementById('form-email-login');
  var formRegister = document.getElementById('form-email-register');

  if (tabLogin && tabRegister) {
    tabLogin.addEventListener('click', function () {
      tabLogin.classList.add('active');
      tabRegister.classList.remove('active');
      formLogin.style.display = 'block';
      formRegister.style.display = 'none';
      clearLoginError();
    });
    tabRegister.addEventListener('click', function () {
      tabRegister.classList.add('active');
      tabLogin.classList.remove('active');
      formRegister.style.display = 'block';
      formLogin.style.display = 'none';
      clearLoginError();
    });
  }

  if (formLogin) {
    formLogin.addEventListener('submit', async function (e) {
      e.preventDefault();
      var email = document.getElementById('login-email').value.trim();
      var password = document.getElementById('login-password').value;
      if (!email || !password) {
        showLoginError('Unesite email i lozinku.');
        return;
      }
      setLoginLoading(true);
      try {
        await getAuth().signInWithEmailAndPassword(email, password);
        closeLoginModal();
        showToast('Uspješna prijava!');
      } catch (err) {
        handleAuthError(err);
      } finally {
        setLoginLoading(false);
      }
    });
  }

  if (formRegister) {
    formRegister.addEventListener('submit', async function (e) {
      e.preventDefault();
      var email = document.getElementById('register-email').value.trim();
      var password = document.getElementById('register-password').value;
      var password2 = document.getElementById('register-password2').value;
      if (!email || !password) {
        showLoginError('Unesite email i lozinku.');
        return;
      }
      if (password.length < 6) {
        showLoginError('Lozinka mora imati barem 6 znakova.');
        return;
      }
      if (password !== password2) {
        showLoginError('Lozinke se ne podudaraju.');
        return;
      }
      setLoginLoading(true);
      try {
        await getAuth().createUserWithEmailAndPassword(email, password);
        closeLoginModal();
        showToast('Račun uspješno kreiran!');
      } catch (err) {
        handleAuthError(err);
      } finally {
        setLoginLoading(false);
      }
    });
  }

  document.querySelectorAll('#modal-login .modal-close, #modal-login .modal-backdrop-close').forEach(function (el) {
    el.addEventListener('click', closeLoginModal);
  });
  if (modal) {
    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeLoginModal();
    });
  }

  // Početno stanje UI
  updateAuthUI(null);
}

// ── Deleting the account ──────────────────────────────────────────────────────
// Deletes the account and its wedding data in Firestore, then this device's
// copy. The App Store requires this to be possible inside the app.

var RECENT_SIGN_IN_MS = 4 * 60 * 1000;

// Firebase deletes an account only right after a sign-in, so sign in again
// unless that just happened. Returns Apple's authorization code (Apple only),
// which is used to revoke the app's access to the Apple ID.
async function reauthenticateForDelete(user) {
  var providerId = (user.providerData[0] && user.providerData[0].providerId) || '';
  var last = Date.parse(user.metadata && user.metadata.lastSignInTime) || 0;
  var recent = Date.now() - last < RECENT_SIGN_IN_MS;
  if (isNativeApp && (providerId === 'google.com' || providerId === 'apple.com')) {
    if (recent && providerId === 'google.com') return null;
    var signIn = await nativeSignInCredential(providerId);
    await user.reauthenticateWithCredential(signIn.credential);
    return signIn.authorizationCode;
  }
  if (recent) return null;
  if (providerId === 'google.com') {
    await user.reauthenticateWithPopup(new firebase.auth.GoogleAuthProvider());
  } else if (providerId === 'password') {
    var password = prompt('Za brisanje računa upišite svoju lozinku:');
    if (!password) throw { code: 'cancelled' };
    await user.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(user.email, password));
  } else {
    throw { code: 'auth/requires-recent-login' };
  }
  return null;
}

async function deleteAccount() {
  var authInst = getAuth();
  var user = authInst && authInst.currentUser;
  if (!user) return;
  if (!confirm('Trajno obrisati račun?\n\n'
    + 'Obrisat će se račun i svi podaci vjenčanja spremljeni u njemu, na svim uređajima. '
    + 'Ovo se ne može poništiti. Ako želite zadržati popis, prvo spremite sigurnosnu kopiju.')) return;
  if (typeof closeOptions === 'function') closeOptions();
  var cloudDeleted = false;
  try {
    var appleCode = await reauthenticateForDelete(user);
    await deleteCloudData(user.uid);
    cloudDeleted = true;
    if (appleCode) await authInst.revokeAccessToken(appleCode).catch(function (e) {
      console.warn('[Auth] revoking Apple access failed', e);
    });
    await user.delete();
    if (typeof nativeSignOut === 'function') await nativeSignOut();
    if (typeof wipeLocalData === 'function') await wipeLocalData();
    if (typeof clearFirestoreCache === 'function') await clearFirestoreCache();
    alert('Račun i podaci su obrisani.');
    location.reload();
  } catch (err) {
    if (err && err.code === 'cancelled') return;
    if (isNativeApp && err && !String(err.code || '').startsWith('auth/') && /cancel/i.test(err.message || '')) return;
    console.error('[Auth] delete account', err);
    var msg = {
      'auth/requires-recent-login': 'Radi sigurnosti se odjavite i ponovno prijavite, pa pokušajte opet.',
      'auth/user-mismatch': 'Prijavili ste se drugim računom. Odaberite račun koji želite obrisati.',
      'auth/wrong-password': 'Pogrešna lozinka.',
      'auth/invalid-credential': 'Pogrešna lozinka.',
      'auth/popup-closed-by-user': 'Prozor za prijavu je zatvoren, račun nije obrisan.',
      'auth/network-request-failed': 'Nema internetske veze.'
    }[err && err.code] || 'Brisanje računa nije uspjelo. Pokušajte ponovno.';
    showToast(msg, true);
    // The account stays, so put its data back in the cloud from this device.
    if (cloudDeleted && currentUser) onAuthForSync(currentUser);
  }
}

function updateAuthUI(user) {
  var loginBtn = document.getElementById('btn-login');
  var userMenu = document.getElementById('user-menu');
  var userName = document.getElementById('user-display-name');
  var userAvatar = document.getElementById('user-avatar');
  var btnDelete = document.getElementById('btn-delete-account');

  if (user) {
    document.body.classList.add('auth-logged-in');
    if (loginBtn) {
      loginBtn.style.display = 'none';
      loginBtn.hidden = true;
    }
    if (userMenu) userMenu.style.display = 'flex';
    if (btnDelete) btnDelete.hidden = false;
    if (userName) {
      userName.textContent = user.displayName || user.email || 'Korisnik';
      userName.title = user.email || '';
    }
    if (userAvatar) {
      if (user.photoURL) {
        var img = document.createElement('img');
        img.alt = '';
        img.referrerPolicy = 'no-referrer';
        img.src = user.photoURL;
        userAvatar.replaceChildren(img);
      } else {
        var initial = (user.displayName || user.email || '?').charAt(0).toUpperCase();
        var span = document.createElement('span');
        span.textContent = initial;
        userAvatar.replaceChildren(span);
      }
    }
  } else {
    document.body.classList.remove('auth-logged-in');
    if (loginBtn) {
      loginBtn.style.display = '';
      loginBtn.hidden = false;
    }
    if (userMenu) userMenu.style.display = 'none';
    if (btnDelete) btnDelete.hidden = true;
  }
}

function openLoginModal() {
  var modal = document.getElementById('modal-login');
  if (!modal) return;
  clearLoginError();
  var formLogin = document.getElementById('form-email-login');
  var formRegister = document.getElementById('form-email-register');
  if (formLogin) formLogin.style.display = 'block';
  if (formRegister) formRegister.style.display = 'none';
  document.getElementById('tab-login') && document.getElementById('tab-login').classList.add('active');
  document.getElementById('tab-register') && document.getElementById('tab-register').classList.remove('active');
  modal.style.display = 'flex';
}

function closeLoginModal() {
  var modal = document.getElementById('modal-login');
  if (modal) modal.style.display = 'none';
  setLoginLoading(false);
  clearLoginError();
}

function setLoginLoading(loading) {
  document.querySelectorAll('#modal-login button[type="submit"], #btn-google-login, #btn-apple-login').forEach(function (b) {
    // Keep the original markup (the Google button has an SVG logo) so it can be restored.
    if (loading && b._origHTML === undefined) b._origHTML = b.innerHTML;
    b.disabled = loading;
    if (loading) b.textContent = 'Pričekajte…';
    else if (b._origHTML !== undefined) b.innerHTML = b._origHTML;
  });
}

function showLoginError(msg) {
  var el = document.getElementById('login-error');
  if (el) {
    el.textContent = msg;
    el.style.display = 'block';
  }
}

function clearLoginError() {
  var el = document.getElementById('login-error');
  if (el) {
    el.textContent = '';
    el.style.display = 'none';
  }
}

function handleAuthError(err) {
  console.error('[Auth]', err);
  var code = (err && err.code) || '';
  var msg = (err && err.message) || 'Došlo je do greške.';
  // The user closed the native Google/Apple sign-in screen.
  if (isNativeApp && !code.startsWith('auth/') && /cancel/i.test(msg)) {
    clearLoginError();
    return;
  }
  var map = {
    'auth/popup-closed-by-user': 'Prozor za prijavu je zatvoren.',
    'auth/cancelled-popup-request': 'Prijava je otkazana.',
    'auth/popup-blocked': 'Preglednik je blokirao prozor. Dopustite pop-upove.',
    'auth/user-not-found': 'Korisnik s tim emailom ne postoji.',
    'auth/wrong-password': 'Pogrešna lozinka.',
    'auth/invalid-email': 'Neispravan email.',
    'auth/email-already-in-use': 'Email je već registriran.',
    'auth/weak-password': 'Lozinka je previše slaba (min. 6 znakova).',
    'auth/too-many-requests': 'Previše pokušaja. Pokušajte kasnije.',
    'auth/network-request-failed': 'Nema internetske veze.',
    'auth/invalid-credential': 'Neispravni podaci za prijavu.',
    'auth/operation-not-allowed': 'Ova metoda prijave nije uključena u Firebase konzoli.',
    'auth/unauthorized-domain': 'Ova domena nije autorizirana u Firebase konzoli (Authorized domains).'
  };
  if (map[code]) msg = map[code];
  showLoginError(msg);
}

// action: { label, onClick, duration } adds a button (e.g. "Poništi").
// duration 0 keeps the toast until the button is used.
function showToast(message, isError, action) {
  if (isError && typeof hapticWarning === 'function') hapticWarning();
  var toast = document.getElementById('auth-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'auth-toast';
    toast.className = 'auth-toast';
    toast.setAttribute('role', 'status');
    document.body.appendChild(toast);
  }
  toast.textContent = '';
  var text = document.createElement('span');
  text.textContent = message;
  toast.appendChild(text);
  toast.classList.toggle('error', !!isError);
  toast.classList.toggle('has-action', !!action);
  if (action) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = action.label;
    btn.addEventListener('click', function () {
      toast.classList.remove('show');
      action.onClick();
    });
    toast.appendChild(btn);
  }
  toast.classList.add('show');
  clearTimeout(toast._timer);
  var duration = action && action.duration !== undefined ? action.duration : (action ? 6000 : 3200);
  if (duration) toast._timer = setTimeout(function () { toast.classList.remove('show'); }, duration);
}

function getCurrentUser() {
  return currentUser;
}
