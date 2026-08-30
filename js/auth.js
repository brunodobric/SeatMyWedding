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
        if (authInst) await authInst.signOut();
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
        var provider = new firebase.auth.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        await authInst.signInWithPopup(provider);
        closeLoginModal();
        showToast('Uspješna prijava!');
      } catch (err) {
        handleAuthError(err);
      } finally {
        setLoginLoading(false);
      }
    });
  }

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

function updateAuthUI(user) {
  var loginBtn = document.getElementById('btn-login');
  var userMenu = document.getElementById('user-menu');
  var userName = document.getElementById('user-display-name');
  var userAvatar = document.getElementById('user-avatar');

  if (user) {
    document.body.classList.add('auth-logged-in');
    if (loginBtn) {
      loginBtn.style.display = 'none';
      loginBtn.hidden = true;
    }
    if (userMenu) userMenu.style.display = 'flex';
    if (userName) {
      userName.textContent = user.displayName || user.email || 'Korisnik';
      userName.title = user.email || '';
    }
    if (userAvatar) {
      if (user.photoURL) {
        userAvatar.innerHTML = '<img src="' + user.photoURL + '" alt="" referrerpolicy="no-referrer">';
      } else {
        var initial = (user.displayName || user.email || '?').charAt(0).toUpperCase();
        userAvatar.innerHTML = '<span>' + initial + '</span>';
      }
    }
  } else {
    document.body.classList.remove('auth-logged-in');
    if (loginBtn) {
      loginBtn.style.display = '';
      loginBtn.hidden = false;
    }
    if (userMenu) userMenu.style.display = 'none';
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
  document.querySelectorAll('#modal-login button[type="submit"], #btn-google-login').forEach(function (b) {
    b.disabled = loading;
    if (loading) b.dataset.origText = b.dataset.origText || b.textContent;
    b.textContent = loading ? 'Pričekajte…' : (b.dataset.origText || b.textContent);
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

function showToast(message, isError) {
  var toast = document.getElementById('auth-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'auth-toast';
    toast.className = 'auth-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.toggle('error', !!isError);
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(function () { toast.classList.remove('show'); }, 3200);
}

function getCurrentUser() {
  return currentUser;
}
