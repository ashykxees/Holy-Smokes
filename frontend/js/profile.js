const MAX_PICTURE_SIZE = 2 * 1024 * 1024;

function onAuthReady(user) {
  const isOnboarding = window.location.pathname === '/onboarding.html';
  if (isOnboarding && user.onboarding_completed) {
    window.location.href = '/';
    return;
  }
  if (!isOnboarding && !user.onboarding_completed) {
    window.location.href = '/onboarding.html';
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

  if (user.first_name) document.getElementById('first-name').value = user.first_name;
  if (user.last_name) document.getElementById('last-name').value = user.last_name;
  if (user.nickname) document.getElementById('nickname').value = user.nickname;
  if (user.phone) document.getElementById('phone').value = user.phone;
  if (dcCheckbox) dcCheckbox.checked = !!user.is_dc_employee;
  if (picturePreview && user.picture) picturePreview.src = user.picture;

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
    let picture = picturePreview && picturePreview.dataset.value ? picturePreview.dataset.value : '';
    if (!picture && user.picture) picture = user.picture;

    if (!first_name || !last_name) {
      alert('First and last name are required.');
      return;
    }
    if (!is_dc_employee && isOnboarding && !phone) {
      alert('Phone number is required unless you are a DC employee.');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    try {
      await fetchJSON('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ first_name, last_name, nickname, phone, is_dc_employee, picture }),
      });
      window.location.href = '/';
    } catch (err) {
      alert(err.message);
      saveBtn.disabled = false;
      saveBtn.textContent = isOnboarding ? 'Complete Setup' : 'Save Changes';
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
