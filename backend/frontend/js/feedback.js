// ---------------------------------------------------------------------------
// FEEDBACK FORM SETTINGS
//
// Edit the title, intro, and QUESTIONS below to change the form.
// Each question is one { ... } block. Add, remove, or reorder blocks freely.
//
//   id:       short unique name for the question (letters, no spaces)
//   label:    the question shown to the member
//   help:     optional smaller text under the question
//   type:     'name'     - filled in from their account, can't be edited
//             'email'    - filled in from their account, can't be edited
//             'text'     - one-line answer
//             'long'     - paragraph answer
//             'choice'   - pick one of the options
//   options:  list of choices (only for type 'choice')
//   required: true if they must answer before submitting
// ---------------------------------------------------------------------------

const FEEDBACK_TITLE = 'Team Post-Mortem';

const FEEDBACK_INTRO = 'A short reflection after an event or project. This is not about blame; it is about learning what worked and getting better as a team. Be honest and specific.';

const QUESTIONS = [
  {
    id: 'name',
    label: 'Name',
    type: 'name',
  },
  {
    id: 'email',
    label: 'Email',
    type: 'email',
  },
  {
    id: 'event',
    label: 'What event or project are you reflecting on?',
    help: 'For example: Homecoming game, a catering order, a cook-off.',
    type: 'text',
    required: true,
  },
  {
    id: 'went_well',
    label: 'What went well?',
    help: 'When did excellence show up? What are you proud of?',
    type: 'long',
    required: true,
  },
  {
    id: 'why_it_worked',
    label: 'What made that possible?',
    help: 'What did we do differently this time? What strengths or preparation paid off?',
    type: 'long',
    required: true,
  },
  {
    id: 'shout_outs',
    label: 'Shout-outs',
    help: 'Which teammates stepped up, and how?',
    type: 'long',
  },
  {
    id: 'pain_points',
    label: 'What felt hard or did not go as planned?',
    type: 'long',
    required: true,
  },
  {
    id: 'root_cause',
    label: 'What was really behind that challenge?',
    type: 'choice',
    options: ['Preparation', 'Communication', 'Something else'],
    required: true,
  },
  {
    id: 'root_cause_detail',
    label: 'Explain the root cause',
    help: 'Keep it about growth, not blame.',
    type: 'long',
  },
  {
    id: 'seen_before',
    label: 'Have we seen this pattern before?',
    type: 'choice',
    options: ['Yes', 'No', 'Not sure'],
    required: true,
  },
  {
    id: 'next_time',
    label: 'What would need to be different for this to go smoothly next time?',
    type: 'long',
    required: true,
  },
  {
    id: 'takeaway',
    label: 'What is your biggest takeaway?',
    type: 'text',
    required: true,
  },
];

// ---------------------------------------------------------------------------

function onAuthReady(user) {
  document.getElementById('feedback-title').textContent = FEEDBACK_TITLE;
  document.getElementById('feedback-intro').textContent = FEEDBACK_INTRO;
  document.title = `${FEEDBACK_TITLE} | Holy Smokes`;
  renderQuestions(user);
  document.getElementById('feedback-form').addEventListener('submit', submitFeedback);
  document.getElementById('feedback-again').addEventListener('click', () => {
    renderQuestions(user);
    document.getElementById('feedback-thanks').classList.add('hidden');
    document.getElementById('feedback-form').classList.remove('hidden');
  });
  if (user && user.is_manager) {
    document.getElementById('responses-section').classList.remove('hidden');
    loadResponses();
  }
}

function questionInputHtml(q, user) {
  const inputId = `q-${q.id}`;
  if (q.type === 'name' || q.type === 'email') {
    const value = q.type === 'name' ? user.name : user.email;
    return `<input id="${inputId}" type="text" class="fb-input" value="${escapeHtml(value)}" readonly>`;
  }
  if (q.type === 'long') {
    return `<textarea id="${inputId}" rows="4" class="fb-input" maxlength="5000"></textarea>`;
  }
  if (q.type === 'choice') {
    const options = (q.options || []).map(option => `
      <label class="fb-choice relative">
        <input type="radio" name="${inputId}" value="${escapeHtml(option)}">
        <span>${escapeHtml(option)}</span>
      </label>`).join('');
    return `<div id="${inputId}" class="flex flex-wrap gap-2">${options}</div>`;
  }
  return `<input id="${inputId}" type="text" class="fb-input" maxlength="500">`;
}

function renderQuestions(user) {
  const container = document.getElementById('questions');
  container.innerHTML = QUESTIONS.map((q, index) => `
    <div class="fb-question" data-question="${escapeHtml(q.id)}">
      <div class="fb-num mb-1">${String(index + 1).padStart(2, '0')}</div>
      <label for="q-${escapeHtml(q.id)}" class="block text-lg font-semibold">
        ${escapeHtml(q.label)}${q.required ? ' <span class="text-red-500">*</span>' : ''}
      </label>
      ${q.help ? `<p class="text-sm text-gray-500 mt-1">${escapeHtml(q.help)}</p>` : ''}
      <div class="mt-3">${questionInputHtml(q, user)}</div>
    </div>`).join('');
}

function answerFor(q) {
  if (q.type === 'choice') {
    const checked = document.querySelector(`input[name="q-${q.id}"]:checked`);
    return checked ? checked.value : '';
  }
  return document.getElementById(`q-${q.id}`).value.trim();
}

async function submitFeedback(e) {
  e.preventDefault();
  const errorEl = document.getElementById('feedback-error');
  errorEl.classList.add('hidden');
  const answers = QUESTIONS
    .filter(q => q.type !== 'name' && q.type !== 'email')
    .map(q => ({ id: q.id, question: q.label, answer: answerFor(q), required: q.required }));

  const missing = answers.find(a => a.required && !a.answer);
  if (missing) {
    errorEl.textContent = `Please answer: ${missing.question}`;
    errorEl.classList.remove('hidden');
    const block = document.querySelector(`[data-question="${missing.id}"]`);
    block.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  try {
    await fetchJSON('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        answers: answers.map(a => ({ question: a.question, answer: a.answer })),
      }),
    });
    document.getElementById('feedback-form').classList.add('hidden');
    document.getElementById('feedback-thanks').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (currentUser && currentUser.is_manager) {
      loadResponses();
    }
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  }
}

async function loadResponses() {
  const container = document.getElementById('responses');
  try {
    const rows = await fetchJSON('/api/feedback');
    if (!rows.length) {
      container.innerHTML = '<p class="text-sm text-gray-500">No responses yet.</p>';
      return;
    }
    container.innerHTML = rows.map(r => `
      <details class="card">
        <summary class="cursor-pointer flex flex-wrap items-baseline gap-x-3">
          <span class="font-semibold">${escapeHtml(r.user_name || r.user_email)}</span>
          <span class="text-sm text-gray-500">${escapeHtml(r.user_email)}</span>
          <span class="text-xs text-gray-400 ml-auto">${formatTime(r.created_at)}</span>
        </summary>
        <dl class="mt-4 space-y-3 text-sm">
          ${r.answers.map(a => `
            <div>
              <dt class="font-medium text-gray-700">${escapeHtml(a.question)}</dt>
              <dd class="text-gray-600 whitespace-pre-wrap">${a.answer ? escapeHtml(a.answer) : '<span class="text-gray-400">No answer</span>'}</dd>
            </div>`).join('')}
        </dl>
      </details>`).join('');
  } catch (err) {
    container.innerHTML = `<p class="text-sm text-red-600">${escapeHtml(err.message)}</p>`;
  }
}
