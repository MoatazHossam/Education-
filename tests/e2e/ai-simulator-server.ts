import { AiSimulator } from '../helpers/ai-simulator.js';

// The E2E server's AI provider (tests/e2e/server.ts, startAiSimulator). Requests for test questions get
// three questions (src/classroom/question-suggestions.ts), requests for homework one homework
// (src/classroom/homework-suggestions.ts); anything else, such as the platform administration's
// connection test, gets the reply that test expects.
const q = (o: Record<string, unknown>) => ({ prompt: '', choices: [], correct_choices: [], is_true: null, accepted_answers: [], marking_guide: null, points: 1, explanation: '', ...o });
const QUESTIONS = {
  questions: [
    q({ type: 'single', prompt: 'Which of these is a force?', choices: ['A push', 'A colour', 'A smell'], correct_choices: [0], explanation: 'A force is a push or a pull.' }),
    q({ type: 'true_false', prompt: 'Friction slows moving objects down.', is_true: true, explanation: 'Friction acts against motion.' }),
    q({ type: 'short', prompt: 'What pulls objects towards the Earth?', accepted_answers: ['gravity', 'the force of gravity'], points: 2, explanation: 'Gravity pulls masses together.' }),
  ],
};

const HOMEWORK = {
  title: 'Forces around us',
  instructions: '1. Find three pushes and three pulls in your home.\n2. Write one sentence about each.\n3. Hand in your list as text or a photo of your notebook.',
  estimated_minutes: 20,
  teacher_notes: 'Checks that students see a force as a push or a pull.',
};

const sim = new AiSimulator(process.env.E2E_AI_KEY!);
sim.defaultText = '{"arabic":"منهج"}';
sim.respond = (_provider, body) => {
  const text = JSON.stringify(body);
  if (text.includes('write questions for their online tests')) return JSON.stringify(QUESTIONS);
  if (text.includes('write homework for their classes')) return JSON.stringify(HOMEWORK);
  return undefined;
};
await sim.start(Number(process.env.E2E_AI_PORT));
