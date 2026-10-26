// Captures the screenshots of docs/USER_GUIDE.ar.md, in the Arabic interface: `npm run docs:screenshots:ar`.
// Set here rather than on the command line, so the script works the same on Windows.
process.env.GUIDE_LANG = 'ar';

export { default } from './playwright.guide.config';
