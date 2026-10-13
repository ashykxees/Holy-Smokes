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
//   minWords: smallest number of words allowed (only for 'text' and 'long')
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
    minWords: 25,
  },
  {
    id: 'why_it_worked',
    label: 'What made that possible?',
    help: 'What did we do differently this time? What strengths or preparation paid off?',
    type: 'long',
    required: true,
    minWords: 25,
  },
  {
    id: 'shout_outs',
    label: 'Shout-outs',
    help: 'Which teammates stepped up, and how?',
    type: 'long',
    required: true,
    minWords: 15,
  },
  {
    id: 'pain_points',
    label: 'What felt hard or did not go as planned?',
    type: 'long',
    required: true,
    minWords: 25,
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
    required: true,
    minWords: 20,
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
    minWords: 25,
  },
  {
    id: 'takeaway',
    label: 'What is your biggest takeaway?',
    type: 'text',
    required: true,
    minWords: 10,
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
    document.getElementById('responses-link').classList.remove('hidden');
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
      ${q.minWords ? `<p id="wc-${escapeHtml(q.id)}" class="fb-count mt-2"></p>` : ''}
    </div>`).join('');
  QUESTIONS.filter(q => q.minWords).forEach(q => {
    const input = document.getElementById(`q-${q.id}`);
    input.addEventListener('input', () => updateWordCount(q));
    updateWordCount(q);
  });
}

function countWords(text) {
  return text.split(/\s+/).filter(word => /[a-z0-9]/i.test(word)).length;
}

function updateWordCount(q) {
  const count = countWords(document.getElementById(`q-${q.id}`).value);
  const counter = document.getElementById(`wc-${q.id}`);
  counter.textContent = `${count} / ${q.minWords} words`;
  counter.classList.toggle('met', count >= q.minWords);
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
    .map(q => ({ id: q.id, question: q.label, answer: answerFor(q), required: q.required, minWords: q.minWords }));

  let problem = null;
  for (const a of answers) {
    if (a.required && !a.answer) {
      problem = { id: a.id, message: `Please answer: ${a.question}` };
      break;
    }
    const words = countWords(a.answer);
    if (a.minWords && (a.required || a.answer) && words < a.minWords) {
      problem = { id: a.id, message: `"${a.question}" needs at least ${a.minWords} words (you have ${words}).` };
      break;
    }
  }
  if (problem) {
    errorEl.textContent = problem.message;
    errorEl.classList.remove('hidden');
    const block = document.querySelector(`[data-question="${problem.id}"]`);
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
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  }
}
