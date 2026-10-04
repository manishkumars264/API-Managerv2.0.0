'use strict';

const RECIPIENT = 'manishkumars264@gmail.com';

function bugReportMailto(version) {
  const subject = `API Manager v${version} - Issue found`;
  const body = [
    'Summary / description:', '',
    'Steps to reproduce:', '1.', '2.', '3.', '',
    'Expected result (optional):', '',
    'Actual result (optional):', '',
    'Screenshots / videos: Please attach files to this email.', '',
    `Application version: API Manager v${version}`, ''
  ].join('\r\n');
  return `mailto:${RECIPIENT}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

async function openBugReportDraft(shell, version) {
  try { await shell.openExternal(bugReportMailto(version)); }
  catch {
    throw new Error(`Could not open your email app. Set a default email app, or email ${RECIPIENT} with your issue and application version.`);
  }
}

module.exports = { bugReportMailto, openBugReportDraft };
