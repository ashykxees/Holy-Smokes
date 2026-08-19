function displayName(user) {
  const first = (user.first_name || '').trim() || (user.nickname || '').trim();
  if (first) return first;
  return user.name ? user.name.split(' ')[0] : user.email.split('@')[0];
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
    preview.innerHTML = escapeHtml(`--\n${name}\nHoly Smokes BBQ Team\nholysmokes.cc`).replace(/\n/g, '<br>');
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
