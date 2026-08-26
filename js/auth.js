/**
 * Firebase Authentication – Google + Email/Password
 * UI je na hrvatskom, u skladu s ostatkom aplikacije.
 */

let currentUser = null;

function isAuthConfigured() {
  try {
    const cfg = firebase.app().options;
    return cfg && cfg.apiKey && cfg.apiKey !== 'YOUR_API_KEY';
  } catch {
    return false;
  }
}

function setupAuth() {
  const loginBtn = document.getElementById('btn-login');
  const userMenu = document.getElementById('user-menu');
  const userName = document.getElementById('user-display-name');
  const userAvatar = document.getElementById('user-avatar');
  const btnLogout = document.getElementById('btn-logout');
  const modal = document.getElementById('modal-login');

  if (!isAuthConfigured()) {
    // Config nije postavljen – sakrij login i pokaži upozorenje u konzoli
    if (loginBtn) loginBtn.style.display = 'none';
    console.warn(
      '[Firebase] apiKey još nije postavljen. Uredi js/firebase-config.js s podacima iz Firebase konzole.'
    );
    return;
  }

  // Auth state listener
  auth.onAuthStateChanged(user => {
    currentUser = user;
    updateAuthUI(user);
    window.dispatchEvent(new CustomEvent('authChange', { detail: { user } }));
  });

  // Otvori modal za prijavu
  if (loginBtn) {
    loginBtn.addEventListener('click', () => {
      openLoginModal();
    });
  }

  // Odjava
  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      try {
        await auth.signOut();
        closeLoginModal();
        showToast('Odjavljeni ste');
      } catch (err) {
        showToast('Greška pri odjavi: ' + err.message, true);
      }
    });
  }

  // Google prijava
  const btnGoogle = document.getElementById('btn-google-login');
  if (btnGoogle) {
    btnGoogle.addEventListener('click', async () => {
      setLoginLoading(true);
      try {
        const provider = new firebase.auth.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        await auth.signInWithPopup(provider);
        closeLoginModal();
        showToast('Uspješna prijava!');
      } catch (err) {
        handleAuthError(err);
      } finally {
        setLoginLoading(false);
      }
    });
  }

  // Email / lozinka – tabovi
  const tabLogin = document.getElementById('tab-login');
  const tabRegister = document.getElementById('tab-register');
  const formLogin = document.getElementById('form-email-login');
  const formRegister = document.getElementById('form-email-register');

  if (tabLogin && tabRegister) {
    tabLogin.addEventListener('click', () => {
      tabLogin.classList.add('active');
      tabRegister.classList.remove('active');
      formLogin.style.display = 'block';
      formRegister.style.display = 'none';
      clearLoginError();
    });
    tabRegister.addEventListener('click', () => {
      tabRegister.classList.add('active');
      tabLogin.classList.remove('active');
      formRegister.style.display = 'block';
      formLogin.style.display = 'none';
      clearLoginError();
    });
  }

  // Prijava emailom
  if (formLogin) {
    formLogin.addEventListener('submit', async e => {
      e.preventDefault();
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;
      if (!email || !password) {
        showLoginError('Unesite email i lozinku.');
        return;
      }
      setLoginLoading(true);
      try {
        await auth.signInWithEmailAndPassword(email, password);
        closeLoginModal();
        showToast('Uspješna prijava!');
      } catch (err) {
        handleAuthError(err);
      } finally {
        setLoginLoading(false);
      }
    });
  }

  // Registracija
  if (formRegister) {
    formRegister.addEventListener('submit', async e => {
      e.preventDefault();
      const email = document.getElementById('register-email').value.trim();
      const password = document.getElementById('register-password').value;
      const password2 = document.getElementById('register-password2').value;
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
        await auth.createUserWithEmailAndPassword(email, password);
        closeLoginModal();
        showToast('Račun uspješno kreiran!');
      } catch (err) {
        handleAuthError(err);
      } finally {
        setLoginLoading(false);
      }
    });
  }

  // Zatvori modal
  document.querySelectorAll('#modal-login .modal-close, #modal-login .modal-backdrop-close').forEach(el => {
    el.addEventListener('click', closeLoginModal);
  });
  modal?.addEventListener('click', e => {
    if (e.target === modal) closeLoginModal();
  });
}

function updateAuthUI(user) {
  const loginBtn = document.getElementById('btn-login');
  const userMenu = document.getElementById('user-menu');
  const userName = document.getElementById('user-display-name');
  const userAvatar = document.getElementById('user-avatar');

  if (user) {
    if (loginBtn) loginBtn.style.display = 'none';
    if (userMenu) userMenu.style.display = 'flex';
    if (userName) {
      userName.textContent = user.displayName || user.email || 'Korisnik';
      userName.title = user.email || '';
    }
    if (userAvatar) {
      if (user.photoURL) {
        userAvatar.innerHTML = `<img src="${user.photoURL}" alt="" referrerpolicy="no-referrer">`;
      } else {
        const initial = (user.displayName || user.email || '?').charAt(0).toUpperCase();
        userAvatar.innerHTML = `<span>${initial}</span>`;
      }
    }
  } else {
    if (loginBtn) loginBtn.style.display = '';
    if (userMenu) userMenu.style.display = 'none';
  }
}

function openLoginModal() {
  const modal = document.getElementById('modal-login');
  if (!modal) return;
  clearLoginError();
  document.getElementById('form-email-login').style.display = 'block';
  document.getElementById('form-email-register').style.display = 'none';
  document.getElementById('tab-login')?.classList.add('active');
  document.getElementById('tab-register')?.classList.remove('active');
  modal.style.display = 'flex';
}

function closeLoginModal() {
  const modal = document.getElementById('modal-login');
  if (modal) modal.style.display = 'none';
  setLoginLoading(false);
  clearLoginError();
}

function setLoginLoading(loading) {
  const btns = document.querySelectorAll('#modal-login button[type="submit"], #btn-google-login');
  btns.forEach(b => {
    b.disabled = loading;
    if (loading) b.dataset.origText = b.dataset.origText || b.textContent;
    b.textContent = loading ? 'Pričekajte…' : (b.dataset.origText || b.textContent);
  });
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  if (el) {
    el.textContent = msg;
    el.style.display = 'block';
  }
}

function clearLoginError() {
  const el = document.getElementById('login-error');
  if (el) {
    el.textContent = '';
    el.style.display = 'none';
  }
}

function handleAuthError(err) {
  console.error('[Auth]', err);
  const code = err.code || '';
  let msg = err.message || 'Došlo je do greške.';
  const map = {
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
  };
  if (map[code]) msg = map[code];
  showLoginError(msg);
}

function showToast(message, isError = false) {
  let toast = document.getElementById('auth-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'auth-toast';
    toast.className = 'auth-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 3200);
}

/** Vraća trenutnog korisnika (ili null) */
function getCurrentUser() {
  return currentUser;
}
