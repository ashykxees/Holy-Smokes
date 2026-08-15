function onAuthReady(user) {
  if (!user) {
    window.location.href = '/login';
    return;
  }
  if (user.is_approved) {
    window.location.href = '/dashboard';
    return;
  }
  setInterval(async () => {
    try {
      const u = await fetchJSON('/api/me');
      if (u && u.is_approved) {
        window.location.href = '/dashboard';
      }
    } catch (err) {
      window.location.href = '/login';
    }
  }, 5000);
}

window.onAuthReady = onAuthReady;
