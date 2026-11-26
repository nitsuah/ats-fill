// tracker-csv.js
// CSV import/export logic for tracker

import { sendMessage } from '../../lib/utils.js';
import { renderTracker } from './tracker-ui.js';
import { showScreen } from '../ux/navigation.js';
import { buildTrackerCsv } from '../../lib/csv-cell.js';

function setTrackerScreenStatus(msg, type = '') {
  const el = document.getElementById('tracker-status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'status-msg' + (type ? ' ' + type : '');
}

export function exportCsv(applications) {
  const csv = buildTrackerCsv(applications);
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'apply-bot-tracker.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export async function importTrackerCsvFile(event) {
  const input = event?.target;
  const file = input?.files?.[0];
  if (!file) return;

  setTrackerScreenStatus('⏳ Importing applications from CSV…');

  try {
    const text = await file.text();
    const resp = await sendMessage({
      type: 'IMPORT_APPLICATIONS_CSV',
      payload: { text },
    });

    if (!resp?.success) {
      throw new Error(resp?.error || 'Could not import the tracker CSV.');
    }

    await renderTracker();
    showScreen('tracker');

    const imported = Number(resp.imported || 0);
    const skipped = Number(resp.skipped || 0);
    const suffix = skipped ? ` (${skipped} skipped)` : '';
    setTrackerScreenStatus(
      `✅ Imported ${imported} application${imported === 1 ? '' : 's'} from CSV${suffix}.`,
      'success'
    );
  } catch (err) {
    setTrackerScreenStatus('❌ ' + err.message, 'error');
  } finally {
    if (input) input.value = '';
  }
}
