function displayName(user) {
  if (user.nickname) return user.nickname.trim();
  const parts = [user.first_name, user.last_name].filter(Boolean);
  if (parts.length) return parts.join(' ').trim();
  return user.name || user.email.split('@')[0];
}

function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

window.onAuthReady = async (user) => {
  if (!user) {
    window.location.href = '/login';
    return;
  }

  const name = displayName(user);
  const preview = document.getElementById('signature-preview');
  if (preview) {
    preview.innerHTML = escapeHtml(`--\n${name}\nDelaware County Christian School\nHoly Smokes BBQ Team\nwww.holysmokes.cc`).replace(/\n/g, '<br>');
  }

  const form = document.getElementById('email-form');
  const submitBtn = document.getElementById('submit-btn');
  const successMessage = document.getElementById('success-message');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    successMessage.classList.add('hidden');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';

    const data = {
      to: form.to.value.trim(),
      subject: form.subject.value.trim(),
      body: form.body.value.trim(),
    };

    try {
      await fetchJSON('/api/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      form.reset();
      successMessage.classList.remove('hidden');
    } catch (err) {
      alert(err.message || 'Failed to send email.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send Email';
    }
  });
};
