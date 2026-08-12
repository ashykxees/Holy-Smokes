const MAX_PICTURE_SIZE = 2 * 1024 * 1024;

function onAuthReady(user) {
  const isOnboarding = window.location.pathname === '/onboarding';
  if (isOnboarding && user && user.onboarding_completed) {
    window.location.href = '/';
    return;
  }
  if (!isOnboarding && !user) {
    window.location.href = '/login';
    return;
  }
  if (!isOnboarding && user && !user.onboarding_completed) {
    window.location.href = '/onboarding';
    return;
  }
  initProfileForm(user, isOnboarding);
}

function initProfileForm(user, isOnboarding) {
  const form = document.getElementById('profile-form');
  const dcCheckbox = document.getElementById('is-dc-employee');
  const phoneGroup = document.getElementById('phone-group');
  const pictureInput = document.getElementById('profile-picture');
  const picturePreview = document.getElementById('picture-preview');
  const saveBtn = document.getElementById('save-button');

  if (!form) return;

  if (user) {
    if (user.first_name) document.getElementById('first-name').value = user.first_name;
    if (user.last_name) document.getElementById('last-name').value = user.last_name;
    if (user.nickname) document.getElementById('nickname').value = user.nickname;
    if (user.phone) document.getElementById('phone').value = user.phone;
    if (user.dc_email) document.getElementById('dc-email').value = user.dc_email;
    if (dcCheckbox) dcCheckbox.checked = !!user.is_dc_employee;
    if (picturePreview && user.picture) picturePreview.src = user.picture;
  }

  function togglePhone() {
    if (!phoneGroup) return;
    if (dcCheckbox.checked) {
      phoneGroup.classList.add('hidden');
      document.getElementById('phone').removeAttribute('required');
    } else {
      phoneGroup.classList.remove('hidden');
      if (isOnboarding) document.getElementById('phone').setAttribute('required', 'required');
    }
  }
  if (dcCheckbox) {
    dcCheckbox.addEventListener('change', togglePhone);
    togglePhone();
  }

  if (pictureInput) {
    pictureInput.addEventListener('change', async () => {
      const file = pictureInput.files[0];
      if (!file) return;
      if (file.size > MAX_PICTURE_SIZE) {
        alert('Profile picture must be under 2 MB.');
        pictureInput.value = '';
        return;
      }
      const dataUrl = await fileToDataUrl(file);
      picturePreview.src = dataUrl;
      picturePreview.dataset.value = dataUrl;
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const first_name = document.getElementById('first-name').value.trim();
    const last_name = document.getElementById('last-name').value.trim();
    const nickname = document.getElementById('nickname').value.trim();
    const phone = document.getElementById('phone').value.trim();
    const is_dc_employee = dcCheckbox ? dcCheckbox.checked : false;
    const dc_email = (document.getElementById('dc-email').value || '').trim().toLowerCase();
    let picture = picturePreview && picturePreview.dataset.value ? picturePreview.dataset.value : '';
    if (!picture && user && user.picture) picture = user.picture;

    if (!first_name || !last_name) {
      alert('First and last name are required.');
      return;
    }
    if (!is_dc_employee && isOnboarding && !phone) {
      alert('Phone number is required unless you are a DC employee.');
      return;
    }

    const payload = { first_name, last_name, nickname, phone, is_dc_employee, dc_email, picture };

    if (isOnboarding) {
      const email = (document.getElementById('email').value || '').trim().toLowerCase();
      const password = document.getElementById('password').value;
      const confirm_password = document.getElementById('confirm-password').value;
      if (!email) {
        alert('DC Email is required.');
        return;
      }
      if (!email.endsWith('@dccs.org')) {
        alert('Email must be a @dccs.org address.');
        return;
      }
      if (password.length < 6) {
        alert('Password must be at least 6 characters.');
        return;
      }
      if (password !== confirm_password) {
        alert('Passwords do not match.');
        return;
      }
      payload.email = email;
      payload.password = password;
      payload.confirm_password = confirm_password;
    }

    if (!isOnboarding) {
      const newPassword = document.getElementById('new-password');
      const currentPassword = document.getElementById('current-password');
      if (newPassword && newPassword.value) {
        if (newPassword.value.length < 6) {
          alert('New password must be at least 6 characters.');
          return;
        }
        if (!currentPassword || !currentPassword.value) {
          alert('Current password is required to set a new password.');
          return;
        }
        payload.new_password = newPassword.value;
        payload.current_password = currentPassword.value;
      }
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    try {
      const endpoint = isOnboarding ? '/api/auth/register' : '/api/profile';
      await fetchJSON(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      window.location.href = '/';
    } catch (err) {
      alert(err.message);
      saveBtn.disabled = false;
      saveBtn.textContent = isOnboarding ? 'Create Account' : 'Save Changes';
    }
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

window.onAuthReady = onAuthReady;
